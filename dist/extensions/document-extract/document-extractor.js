//#region extensions/document-extract/document-extractor.ts
const MAX_EXTRACTED_TEXT_CHARS = 2e5;
const MAX_RENDER_DIMENSION = 1e4;
let pdfEnginePromise = null;
async function loadPdfEngine() {
	if (!pdfEnginePromise) pdfEnginePromise = import("clawpdf").then(({ createEngine }) => createEngine()).catch((err) => {
		pdfEnginePromise = null;
		throw new Error("Dependency clawpdf is required for PDF extraction", { cause: err });
	});
	return pdfEnginePromise;
}
function toDocumentImage(image) {
	return {
		type: "image",
		data: Buffer.from(image.bytes).toString("base64"),
		mimeType: image.mimeType
	};
}
function isPdfPasswordError(err) {
	return Boolean(err && typeof err === "object" && err.code === "password");
}
function pageRange(count) {
	return Array.from({ length: count }, (_, index) => index + 1);
}
function normalizedProcessedPages(result, requestedPages) {
	if (Array.isArray(result.pagesProcessed)) return result.pagesProcessed.filter((page) => requestedPages.includes(page));
	return requestedPages;
}
function buildCoverage(params) {
	const truncationReasons = [];
	if (params.requestedPages.length < params.documentPageCount) truncationReasons.push("page_limit");
	if (params.textTruncated) truncationReasons.push("text_limit");
	if (params.imageTruncated) truncationReasons.push("image_limit");
	if (params.imageError) truncationReasons.push("image_error");
	const processed = [...new Set(params.pagesProcessed)].toSorted((a, b) => a - b);
	const processedSet = new Set(processed);
	const complete = truncationReasons.length === 0 && params.requestedPages.length === params.documentPageCount && params.requestedPages.every((page) => processedSet.has(page));
	return {
		documentPageCount: params.documentPageCount,
		requestedPages: params.requestedPages,
		pagesProcessed: processed,
		complete,
		textChars: params.text.length,
		textBytes: Buffer.byteLength(params.text),
		maxTextChars: MAX_EXTRACTED_TEXT_CHARS,
		truncationReasons
	};
}
async function openPdfDocument(params) {
	try {
		return params.password ? await params.engine.open(params.input, { password: params.password }) : await params.engine.open(params.input);
	} catch (err) {
		if (isPdfPasswordError(err)) throw new Error("PDF requires a password or password is incorrect.", { cause: err });
		throw err;
	}
}
async function extractPdfContent(request) {
	const pdf = await openPdfDocument({
		engine: await loadPdfEngine(),
		input: request.buffer,
		...request.password ? { password: request.password } : {}
	});
	try {
		const pages = request.pageNumbers ? request.pageNumbers.filter((p) => Number.isInteger(p) && p >= 1 && p <= pdf.pageCount).slice(0, request.maxPages) : void 0;
		const requestedPages = pages ?? pageRange(Math.min(pdf.pageCount, request.maxPages));
		const pageSelection = pages ? { pages } : { maxPages: request.maxPages };
		const textResult = await pdf.extract({
			mode: "text",
			...pageSelection,
			maxTextChars: MAX_EXTRACTED_TEXT_CHARS
		});
		const text = textResult.text;
		const textPages = normalizedProcessedPages(textResult, requestedPages);
		if (text.trim().length >= request.minTextChars) return {
			text,
			images: [],
			coverage: buildCoverage({
				documentPageCount: pdf.pageCount,
				requestedPages,
				pagesProcessed: textPages,
				text,
				textTruncated: textResult.truncated?.text
			})
		};
		try {
			const imageResult = await pdf.extract({
				mode: "images",
				...pageSelection,
				image: {
					maxDimension: MAX_RENDER_DIMENSION,
					maxPixels: request.maxPixels,
					forms: true
				}
			});
			const imagePages = normalizedProcessedPages(imageResult, requestedPages);
			return {
				text,
				images: imageResult.images.map(toDocumentImage),
				coverage: buildCoverage({
					documentPageCount: pdf.pageCount,
					requestedPages,
					pagesProcessed: [...textPages, ...imagePages],
					text,
					textTruncated: textResult.truncated?.text,
					imageTruncated: imageResult.truncated?.images
				})
			};
		} catch (err) {
			request.onImageExtractionError?.(err);
			return {
				text,
				images: [],
				coverage: buildCoverage({
					documentPageCount: pdf.pageCount,
					requestedPages,
					pagesProcessed: textPages,
					text,
					textTruncated: textResult.truncated?.text,
					imageError: true
				})
			};
		}
	} finally {
		pdf.destroy();
	}
}
function createPdfDocumentExtractor() {
	return {
		id: "pdf",
		label: "PDF",
		mimeTypes: ["application/pdf"],
		autoDetectOrder: 10,
		extract: extractPdfContent
	};
}
//#endregion
export { createPdfDocumentExtractor };
