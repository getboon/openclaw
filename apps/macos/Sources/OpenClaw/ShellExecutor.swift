import Foundation
import OpenClawIPC

enum ShellExecutor {
    struct ShellResult {
        var stdout: String
        var stderr: String
        var exitCode: Int?
        var timedOut: Bool
        var success: Bool
        var errorMessage: String?
    }

    private final class CompletionBox: @unchecked Sendable {
        private let lock = NSLock()
        private var finished = false
        private let continuation: CheckedContinuation<ShellResult, Never>

        init(continuation: CheckedContinuation<ShellResult, Never>) {
            self.continuation = continuation
        }

        func finish(_ result: ShellResult) {
            self.lock.lock()
            defer { self.lock.unlock() }
            guard !self.finished else { return }
            self.finished = true
            self.continuation.resume(returning: result)
        }
    }

    private static func completedResult(
        status: Int,
        outTask: Task<Data, Never>,
        errTask: Task<Data, Never>) async -> ShellResult
    {
        let out = await outTask.value
        let err = await errTask.value
        return ShellResult(
            stdout: String(decoding: out, as: UTF8.self),
            stderr: String(decoding: err, as: UTF8.self),
            exitCode: status,
            timedOut: false,
            success: status == 0,
            errorMessage: status == 0 ? nil : "exit \(status)")
    }

    /// Drains `handle` to EOF in bounded chunks, keeping at most `maxBytes` of it. Excess bytes
    /// are read and discarded rather than left unread, so a command with unbounded output can't
    /// block on a full pipe buffer while also not accumulating unbounded memory here.
    private static func readCapped(_ handle: FileHandle, maxBytes: Int) -> Data {
        var result = Data()
        while true {
            let chunk = handle.readSafely(upToCount: 65536)
            if chunk.isEmpty { break }
            if result.count < maxBytes {
                result.append(chunk.prefix(maxBytes - result.count))
            }
        }
        return result
    }

    static func runDetailed(
        command: [String],
        cwd: String?,
        env: [String: String]?,
        timeout: Double?,
        maxOutputBytes: Int? = nil) async -> ShellResult
    {
        guard !command.isEmpty else {
            return ShellResult(
                stdout: "",
                stderr: "",
                exitCode: nil,
                timedOut: false,
                success: false,
                errorMessage: "empty command")
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = command
        if let cwd { process.currentDirectoryURL = URL(fileURLWithPath: cwd) }
        if let env { process.environment = env }

        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()
        process.standardOutput = stdoutPipe
        process.standardError = stderrPipe

        let outTask = Task {
            maxOutputBytes.map { self.readCapped(stdoutPipe.fileHandleForReading, maxBytes: $0) }
                ?? stdoutPipe.fileHandleForReading.readToEndSafely()
        }
        let errTask = Task {
            maxOutputBytes.map { self.readCapped(stderrPipe.fileHandleForReading, maxBytes: $0) }
                ?? stderrPipe.fileHandleForReading.readToEndSafely()
        }

        if let timeout, timeout > 0 {
            return await withCheckedContinuation { continuation in
                let completion = CompletionBox(continuation: continuation)

                process.terminationHandler = { terminatedProcess in
                    let status = Int(terminatedProcess.terminationStatus)
                    Task {
                        let result = await self.completedResult(
                            status: status,
                            outTask: outTask,
                            errTask: errTask)
                        completion.finish(result)
                    }
                }

                do {
                    try process.run()
                } catch {
                    completion.finish(
                        ShellResult(
                            stdout: "",
                            stderr: "",
                            exitCode: nil,
                            timedOut: false,
                            success: false,
                            errorMessage: "failed to start: \(error.localizedDescription)"))
                    return
                }

                DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + timeout) {
                    guard process.isRunning else { return }
                    process.terminate()
                    completion.finish(
                        ShellResult(
                            stdout: "",
                            stderr: "",
                            exitCode: nil,
                            timedOut: true,
                            success: false,
                            errorMessage: "timeout"))
                }
            }
        }

        do {
            try process.run()
        } catch {
            return ShellResult(
                stdout: "",
                stderr: "",
                exitCode: nil,
                timedOut: false,
                success: false,
                errorMessage: "failed to start: \(error.localizedDescription)")
        }

        process.waitUntilExit()
        return await self.completedResult(
            status: Int(process.terminationStatus),
            outTask: outTask,
            errTask: errTask)
    }

    static func run(command: [String], cwd: String?, env: [String: String]?, timeout: Double?) async -> Response {
        let result = await self.runDetailed(command: command, cwd: cwd, env: env, timeout: timeout)
        let combined = result.stdout.isEmpty ? result.stderr : result.stdout
        let payload = combined.isEmpty ? nil : Data(combined.utf8)
        return Response(ok: result.success, message: result.errorMessage, payload: payload)
    }
}
