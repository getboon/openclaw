/** Strips C0 (excluding tab/newline/CR) and C1 control code points, then collapses all whitespace to a single space. */
export declare function sanitizeControlCharsForLogging(text: string): string;
