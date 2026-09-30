import { r as matrixSetupAdapter, t as matrixOnboardingAdapter } from "../../setup-surface-DBGp9b81.js";

//#region extensions/matrix/src/setup-contract.d.ts
declare const singleAccountKeysToMove: ("deviceId" | "replyToMode" | "avatarUrl" | "groups" | "responsePrefix" | "dm" | "actions" | "allowBots" | "dangerouslyAllowNameMatching" | "textChunkLimit" | "chunkMode" | "blockStreaming" | "mediaMaxMb" | "ackReaction" | "ackReactionScope" | "threadBindings" | "initialSyncLimit" | "encryption" | "allowlistOnly" | "threadReplies" | "reactionNotifications" | "startupVerification" | "startupVerificationCooldownHours" | "autoJoin" | "autoJoinAllowlist" | "rooms")[];
declare const namedAccountPromotionKeys: ("password" | "deviceId" | "name" | "avatarUrl" | "initialSyncLimit" | "encryption" | "homeserver" | "userId" | "accessToken" | "deviceName")[];
declare function resolveSingleAccountPromotionTarget(params: {
  channel: Record<string, unknown>;
}): string;
//#endregion
export { matrixSetupAdapter, matrixOnboardingAdapter as matrixSetupWizard, namedAccountPromotionKeys, resolveSingleAccountPromotionTarget, singleAccountKeysToMove };