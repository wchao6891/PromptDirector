/**
 * RTF Tokenizer/Lexer
 * Performs lexical analysis on RTF string
 */
// Security and performance constants
const MAX_DOCUMENT_SIZE = 50 * 1024 * 1024; // 50MB
const MAX_TEXT_CHUNK_SIZE = 1024 * 1024; // 1MB per text chunk
const MAX_CONTROL_WORD_LENGTH = 32; // RTF spec limit
const MAX_PARAM_DIGITS = 10; // Allows up to 9,999,999,999
/**
 * Scanner class for tokenizing RTF
 */
class Scanner {
    pos = 0;
    line = 1;
    column = 1;
    input;
    length;
    constructor(input) {
        // Security: Validate document size
        if (input.length > MAX_DOCUMENT_SIZE) {
            throw new Error(`Document size (${input.length} bytes) exceeds maximum allowed size ` +
                `(${MAX_DOCUMENT_SIZE} bytes). This may indicate a malicious document.`);
        }
        this.input = input;
        this.length = input.length;
    }
    /**
     * Check if we've reached end of input
     */
    isEOF() {
        return this.pos >= this.length;
    }
    /**
     * Peek at current character without advancing
     */
    peek(offset = 0) {
        const index = this.pos + offset;
        return index < this.length ? this.input[index] : '';
    }
    /**
     * Advance position and return current character
     */
    advance() {
        if (this.isEOF())
            return '';
        const char = this.input[this.pos];
        this.pos++;
        if (char === '\n') {
            this.line++;
            this.column = 1;
        }
        else {
            this.column++;
        }
        return char;
    }
    /**
     * Get current position
     */
    getPosition() {
        return {
            offset: this.pos,
            line: this.line,
            column: this.column,
        };
    }
    /**
     * Scan a control word (\word or \word123 or \word-123)
     */
    scanControlWord() {
        const startPos = this.pos - 1; // -1 because we already consumed the backslash
        const position = this.getPosition();
        // Extract control word name (alphabetic characters only)
        const nameChars = [];
        while (!this.isEOF() && /[a-zA-Z]/.test(this.peek())) {
            if (nameChars.length >= MAX_CONTROL_WORD_LENGTH) {
                break; // Silently truncate to prevent ReDoS
            }
            nameChars.push(this.advance());
        }
        const name = nameChars.join('');
        // Parse optional numeric parameter
        let param = null;
        if (!this.isEOF() && (this.peek() === '-' || /\d/.test(this.peek()))) {
            const paramChars = [];
            // Handle negative sign
            if (this.peek() === '-') {
                paramChars.push(this.advance());
            }
            // Collect digits
            while (!this.isEOF() && /\d/.test(this.peek())) {
                if (paramChars.length >= MAX_PARAM_DIGITS) {
                    break; // Prevent overflow
                }
                paramChars.push(this.advance());
            }
            const paramStr = paramChars.join('');
            if (paramStr && paramStr !== '-') {
                const parsed = parseInt(paramStr, 10);
                // Validate it's a safe integer
                if (Number.isSafeInteger(parsed)) {
                    param = parsed;
                }
            }
        }
        // Control words are delimited by space (which is consumed) or non-alphabetic character (not consumed)
        if (!this.isEOF() && this.peek() === ' ') {
            this.advance(); // Consume the delimiting space
        }
        return {
            type: 'controlWord',
            name,
            param,
            pos: startPos,
            position,
        };
    }
    /**
     * Scan a hex escape (\\'XX)
     */
    scanHexEscape() {
        const startPos = this.pos - 2; // -2 because we already consumed \ and '
        const position = this.getPosition();
        // Read two hex digits
        const hexChars = [];
        for (let i = 0; i < 2 && !this.isEOF(); i++) {
            const char = this.peek();
            if (/[0-9a-fA-F]/.test(char)) {
                hexChars.push(this.advance());
            }
            else {
                break;
            }
        }
        // Convert hex to character
        const hexStr = hexChars.join('');
        const charCode = parseInt(hexStr, 16);
        const value = String.fromCharCode(charCode);
        return {
            type: 'text',
            value,
            pos: startPos,
            position,
        };
    }
    /**
     * Scan a control symbol (\~, \-, \_, \\, \{, \})
     */
    scanControlSymbol(symbol, backslashPos) {
        const startPos = backslashPos;
        const position = this.getPosition();
        // Map symbols to their meanings
        const symbolMap = {
            '~': '\u00A0', // non-breaking space
            '-': '\u00AD', // optional (soft) hyphen
            _: '\u2011', // non-breaking hyphen
            '\\': '\\', // escaped backslash
            '{': '{', // escaped opening brace
            '}': '}', // escaped closing brace
        };
        const value = symbolMap[symbol] || symbol;
        // For literal escapes (\\, \{, \}), return as text
        if (['\\', '{', '}'].includes(symbol)) {
            return {
                type: 'text',
                value,
                pos: startPos,
                position,
            };
        }
        // For special symbols, return as controlSymbol
        return {
            type: 'controlSymbol',
            name: symbol,
            value,
            pos: startPos,
            position,
        };
    }
}
/**
 * Tokenize RTF string
 *
 * @param rtf - RTF document string
 * @returns Array of tokens
 */
export function tokenize(rtf) {
    // Security: Validate input type
    if (typeof rtf !== 'string') {
        throw new TypeError('Input must be a string');
    }
    const scanner = new Scanner(rtf);
    const tokens = [];
    while (!scanner.isEOF()) {
        const char = scanner.peek();
        if (char === '\\') {
            const backslashPos = scanner.pos; // Save position before consuming backslash
            scanner.advance(); // Consume backslash
            const nextChar = scanner.peek();
            // Check if it's a control word (starts with alphabetic character)
            if (/[a-zA-Z]/.test(nextChar)) {
                const controlWord = scanner.scanControlWord();
                // Special handling for \u (Unicode character)
                if (controlWord.name === 'u' && controlWord.param !== null) {
                    // Convert Unicode code point to character
                    let charCode = controlWord.param;
                    // Handle negative values (treat as unsigned 16-bit)
                    if (charCode < 0) {
                        charCode = 65536 + charCode;
                    }
                    const unicodeChar = String.fromCharCode(charCode);
                    // Add as text token
                    tokens.push({
                        type: 'text',
                        value: unicodeChar,
                        pos: controlWord.pos,
                        position: controlWord.position,
                    });
                    // Skip the alternate representation character (usually '?')
                    if (!scanner.isEOF()) {
                        scanner.advance();
                    }
                }
                else {
                    tokens.push(controlWord);
                }
            }
            // Check if it's a hex escape (\'XX)
            else if (nextChar === "'") {
                scanner.advance(); // Consume the apostrophe
                tokens.push(scanner.scanHexEscape());
            }
            // Check if it's a control symbol
            else if (['~', '-', '_', '\\', '{', '}'].includes(nextChar)) {
                const symbol = scanner.advance();
                tokens.push(scanner.scanControlSymbol(symbol, backslashPos));
            }
        }
        else if (char === '{') {
            // Handle group start
            const startPos = scanner.pos;
            const position = scanner.getPosition();
            scanner.advance();
            tokens.push({
                type: 'groupStart',
                pos: startPos,
                position,
            });
        }
        else if (char === '}') {
            // Handle group end
            const startPos = scanner.pos;
            const position = scanner.getPosition();
            scanner.advance();
            tokens.push({
                type: 'groupEnd',
                pos: startPos,
                position,
            });
        }
        else {
            // Accumulate text - Performance critical: use array for O(n) instead of O(n²)
            const startPos = scanner.pos;
            const position = scanner.getPosition();
            const textChars = [];
            while (!scanner.isEOF() &&
                scanner.peek() !== '\\' &&
                scanner.peek() !== '{' &&
                scanner.peek() !== '}') {
                // Security: Check text chunk size to prevent memory exhaustion
                if (textChars.length >= MAX_TEXT_CHUNK_SIZE) {
                    throw new Error(`Text chunk exceeds maximum size (${MAX_TEXT_CHUNK_SIZE} bytes). ` +
                        `This may indicate a malicious document.`);
                }
                textChars.push(scanner.advance());
            }
            if (textChars.length > 0) {
                tokens.push({
                    type: 'text',
                    value: textChars.join(''),
                    pos: startPos,
                    position,
                });
            }
        }
    }
    return tokens;
}
//# sourceMappingURL=tokenizer.js.map