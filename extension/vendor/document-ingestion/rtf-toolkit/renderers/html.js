/**
 * RTF to HTML Renderer
 * Converts RTF Document AST to HTML
 */
/**
 * Escape HTML special characters (enhanced for security)
 */
function escapeHTML(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
        .replace(/`/g, '&#96;'); // Security: Escape backticks to prevent attribute injection
}
/**
 * Escape CSS values for safe inclusion in style attributes
 */
function escapeCSSValue(value) {
    // Remove potentially dangerous characters
    return value
        .replace(/[<>"'`]/g, '') // Remove HTML chars
        .replace(/[^\w\s-]/g, '') // Allow only alphanumeric, space, hyphen
        .trim();
}
/**
 * Sanitize RGB color value to prevent CSS injection
 */
function sanitizeRGBValue(value) {
    if (typeof value !== 'number' || !isFinite(value)) {
        return 0;
    }
    return Math.max(0, Math.min(255, Math.floor(value)));
}
/**
 * Safe named colors whitelist
 */
const SAFE_NAMED_COLORS = new Set([
    'black', 'white', 'red', 'green', 'blue', 'yellow', 'orange', 'purple',
    'pink', 'gray', 'grey', 'brown', 'cyan', 'magenta', 'transparent',
    'aliceblue', 'antiquewhite', 'aqua', 'aquamarine', 'azure', 'beige',
    'bisque', 'blanchedalmond', 'blueviolet', 'burlywood', 'cadetblue',
    'chartreuse', 'chocolate', 'coral', 'cornflowerblue', 'cornsilk',
    'crimson', 'darkblue', 'darkcyan', 'darkgoldenrod', 'darkgray',
    'darkgreen', 'darkkhaki', 'darkmagenta', 'darkolivegreen', 'darkorange',
    'darkorchid', 'darkred', 'darksalmon', 'darkseagreen', 'darkslateblue',
    'darkslategray', 'darkturquoise', 'darkviolet', 'deeppink', 'deepskyblue',
    'dimgray', 'dodgerblue', 'firebrick', 'floralwhite', 'forestgreen',
    'fuchsia', 'gainsboro', 'ghostwhite', 'gold', 'goldenrod', 'greenyellow',
    'honeydew', 'hotpink', 'indianred', 'indigo', 'ivory', 'khaki',
    'lavender', 'lavenderblush', 'lawngreen', 'lemonchiffon', 'lightblue',
    'lightcoral', 'lightcyan', 'lightgoldenrodyellow', 'lightgray', 'lightgreen',
    'lightpink', 'lightsalmon', 'lightseagreen', 'lightskyblue', 'lightslategray',
    'lightsteelblue', 'lightyellow', 'lime', 'limegreen', 'linen', 'maroon',
    'mediumaquamarine', 'mediumblue', 'mediumorchid', 'mediumpurple',
    'mediumseagreen', 'mediumslateblue', 'mediumspringgreen', 'mediumturquoise',
    'mediumvioletred', 'midnightblue', 'mintcream', 'mistyrose', 'moccasin',
    'navajowhite', 'navy', 'oldlace', 'olive', 'olivedrab', 'orangered',
    'orchid', 'palegoldenrod', 'palegreen', 'paleturquoise', 'palevioletred',
    'papayawhip', 'peachpuff', 'peru', 'plum', 'powderblue', 'rosybrown',
    'royalblue', 'saddlebrown', 'salmon', 'sandybrown', 'seagreen', 'seashell',
    'sienna', 'silver', 'skyblue', 'slateblue', 'slategray', 'snow',
    'springgreen', 'steelblue', 'tan', 'teal', 'thistle', 'tomato',
    'turquoise', 'violet', 'wheat', 'whitesmoke', 'yellowgreen',
]);
/**
 * Sanitize CSS color value to prevent CSS injection attacks.
 * Only allows safe color formats: hex, rgb(), rgba(), and named colors.
 *
 * @param color - User-provided color value
 * @returns Sanitized color or 'transparent' if invalid
 */
function sanitizeCSSColor(color) {
    // Remove whitespace for consistent validation
    const normalized = color.replace(/\s/g, '');
    // Hex colors: #rgb, #rrggbb, #rrggbbaa
    if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(normalized)) {
        return normalized;
    }
    // RGB: rgb(r,g,b)
    const rgbMatch = normalized.match(/^rgb\((\d{1,3}),(\d{1,3}),(\d{1,3})\)$/);
    if (rgbMatch) {
        const r = Math.min(255, parseInt(rgbMatch[1], 10));
        const g = Math.min(255, parseInt(rgbMatch[2], 10));
        const b = Math.min(255, parseInt(rgbMatch[3], 10));
        return `rgb(${r},${g},${b})`;
    }
    // RGBA: rgba(r,g,b,a)
    const rgbaMatch = normalized.match(/^rgba\((\d{1,3}),(\d{1,3}),(\d{1,3}),([\d.]+)\)$/);
    if (rgbaMatch) {
        const r = Math.min(255, parseInt(rgbaMatch[1], 10));
        const g = Math.min(255, parseInt(rgbaMatch[2], 10));
        const b = Math.min(255, parseInt(rgbaMatch[3], 10));
        const a = Math.min(1, Math.max(0, parseFloat(rgbaMatch[4])));
        return `rgba(${r},${g},${b},${a})`;
    }
    // Named colors (whitelist)
    const lowerColor = normalized.toLowerCase();
    if (SAFE_NAMED_COLORS.has(lowerColor)) {
        return lowerColor;
    }
    // Invalid color: return safe default
    return 'transparent';
}
/**
 * Build inline style string from character formatting
 */
function buildCharacterStyle(formatting, doc) {
    const styles = [];
    if (formatting.fontSize !== undefined) {
        // RTF font size is in half-points
        const points = formatting.fontSize / 2;
        styles.push(`font-size: ${points}pt`);
    }
    if (formatting.font !== undefined && doc.fontTable[formatting.font]) {
        // Security: Escape font name to prevent CSS injection
        const fontName = escapeCSSValue(doc.fontTable[formatting.font].name);
        if (fontName) {
            styles.push(`font-family: "${fontName}"`); // Quote the font name
        }
    }
    if (formatting.foregroundColor !== undefined && doc.colorTable[formatting.foregroundColor]) {
        // Security: Sanitize RGB values to prevent CSS injection
        const color = doc.colorTable[formatting.foregroundColor];
        const r = sanitizeRGBValue(color.r);
        const g = sanitizeRGBValue(color.g);
        const b = sanitizeRGBValue(color.b);
        styles.push(`color: rgb(${r}, ${g}, ${b})`);
    }
    if (formatting.backgroundColor !== undefined && doc.colorTable[formatting.backgroundColor]) {
        // Security: Sanitize RGB values to prevent CSS injection
        const color = doc.colorTable[formatting.backgroundColor];
        const r = sanitizeRGBValue(color.r);
        const g = sanitizeRGBValue(color.g);
        const b = sanitizeRGBValue(color.b);
        styles.push(`background-color: rgb(${r}, ${g}, ${b})`);
    }
    return styles.join('; ');
}
/**
 * Build inline style string from paragraph formatting
 */
function buildParagraphStyle(formatting) {
    const styles = [];
    if (formatting.alignment) {
        styles.push(`text-align: ${formatting.alignment}`);
    }
    if (formatting.spaceBefore !== undefined) {
        const points = formatting.spaceBefore / 20; // Convert twips to points
        styles.push(`margin-top: ${points}pt`);
    }
    if (formatting.spaceAfter !== undefined) {
        const points = formatting.spaceAfter / 20;
        styles.push(`margin-bottom: ${points}pt`);
    }
    if (formatting.leftIndent !== undefined) {
        const points = formatting.leftIndent / 20;
        styles.push(`margin-left: ${points}pt`);
    }
    if (formatting.rightIndent !== undefined) {
        const points = formatting.rightIndent / 20;
        styles.push(`margin-right: ${points}pt`);
    }
    if (formatting.firstLineIndent !== undefined) {
        const points = formatting.firstLineIndent / 20;
        styles.push(`text-indent: ${points}pt`);
    }
    return styles.join('; ');
}
/**
 * Default track changes options
 */
const defaultTrackChangesOptions = {
    mode: 'markup',
    insertionColor: '#d4edda',
    deletionColor: '#f8d7da',
    insertionBorderColor: '#28a745',
    deletionBorderColor: '#dc3545',
    includeDataAttributes: true,
    includeTooltips: false,
};
/**
 * Render inline node (text or revision)
 */
function renderInlineNode(node, doc, trackChangesOpts) {
    if (node.type === 'text') {
        return renderTextNode(node, doc);
    }
    else if (node.type === 'revision') {
        return renderRevisionNode(node, doc, trackChangesOpts);
    }
    return '';
}
/**
 * Render text node with formatting
 */
function renderTextNode(node, doc) {
    let html = escapeHTML(node.content);
    // Apply formatting tags
    if (node.formatting.bold) {
        html = `<strong>${html}</strong>`;
    }
    if (node.formatting.italic) {
        html = `<em>${html}</em>`;
    }
    if (node.formatting.underline) {
        html = `<u>${html}</u>`;
    }
    // Apply inline styles if needed (font size, family, color)
    const inlineStyle = buildCharacterStyle(node.formatting, doc);
    if (inlineStyle) {
        html = `<span style="${inlineStyle}">${html}</span>`;
    }
    return html;
}
/**
 * Render revision node with track changes visualization
 */
function renderRevisionNode(node, doc, opts) {
    const isInsertion = node.revisionType === 'insertion';
    const isDeletion = node.revisionType === 'deletion';
    // Handle 'final' mode - show as if all changes were accepted
    if (opts.mode === 'final') {
        if (isDeletion) {
            // Deletions are removed in final mode
            return '';
        }
        // Insertions and formatting changes: render content without revision markup
        return node.content.map((child) => renderInlineNode(child, doc, opts)).join('');
    }
    // Handle 'original' mode - show as if all changes were rejected
    if (opts.mode === 'original') {
        if (isInsertion) {
            // Insertions are removed in original mode
            return '';
        }
        // Deletions and formatting changes: render content without revision markup
        return node.content.map((child) => renderInlineNode(child, doc, opts)).join('');
    }
    // 'markup' mode - show visual track changes
    const content = node.content.map((child) => renderInlineNode(child, doc, opts)).join('');
    // Get author name
    const authorIndex = node.author !== undefined ? node.author : 0;
    const authorName = authorIndex < doc.revisionTable.length ? doc.revisionTable[authorIndex].name : 'Unknown';
    // Build attributes array
    const attrs = [];
    // CSS class based on revision type
    const cssClass = isInsertion ? 'rtf-revision-inserted' : 'rtf-revision-deleted';
    attrs.push(`class="${cssClass}"`);
    // Build style for visual distinction with customizable colors (sanitized to prevent CSS injection)
    let style;
    if (isInsertion) {
        style = `background-color: ${sanitizeCSSColor(opts.insertionColor)}; border-bottom: 2px solid ${sanitizeCSSColor(opts.insertionBorderColor)};`;
    }
    else {
        style = `background-color: ${sanitizeCSSColor(opts.deletionColor)}; text-decoration: line-through; border-bottom: 2px solid ${sanitizeCSSColor(opts.deletionBorderColor)};`;
    }
    attrs.push(`style="${style}"`);
    // Add data attributes if enabled
    if (opts.includeDataAttributes) {
        attrs.push(`data-revision-type="${node.revisionType}"`);
        attrs.push(`data-author="${escapeHTML(authorName)}"`);
        attrs.push(`data-author-index="${authorIndex}"`);
        if (node.timestamp !== undefined) {
            const date = new Date(node.timestamp * 60000);
            attrs.push(`data-timestamp="${date.toISOString()}"`);
        }
    }
    // Add tooltip if enabled
    if (opts.includeTooltips) {
        let tooltipText = `${isInsertion ? 'Inserted' : 'Deleted'} by ${authorName}`;
        if (node.timestamp !== undefined) {
            const date = new Date(node.timestamp * 60000);
            tooltipText += ` on ${date.toLocaleDateString()} at ${date.toLocaleTimeString()}`;
        }
        attrs.push(`title="${escapeHTML(tooltipText)}"`);
    }
    return `<span ${attrs.join(' ')}>${content}</span>`;
}
/**
 * Render paragraph node
 */
function renderParagraphNode(node, doc, trackChangesOpts) {
    const content = node.content
        .map((child) => renderInlineNode(child, doc, trackChangesOpts))
        .join('');
    const inlineStyle = buildParagraphStyle(node.formatting);
    const styleAttr = inlineStyle ? ` style="${inlineStyle}"` : '';
    return `<p${styleAttr}>${content || '&nbsp;'}</p>`;
}
/**
 * Render RTF node to HTML
 */
function renderNode(node, doc, trackChangesOpts) {
    switch (node.type) {
        case 'paragraph':
            return renderParagraphNode(node, doc, trackChangesOpts);
        case 'text':
            return renderTextNode(node, doc);
        default:
            return '';
    }
}
/**
 * Reconstruct placeholder tokens from escaped braces
 * Merges sequences like { { fieldName } } back into {{fieldName}}
 *
 * Uses a multi-pass approach to progressively merge adjacent patterns
 */
function reconstructPlaceholders(html) {
    let result = html;
    let previousResult = '';
    let iterations = 0;
    const maxIterations = 10;
    // Keep iterating until no more changes occur (or max iterations reached)
    while (result !== previousResult && iterations < maxIterations) {
        previousResult = result;
        iterations++;
        // Pass 1: Merge {{fieldName}} that are already adjacent in text
        result = result.replace(/\{\s*\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\s*\}/g, '{{$1}}');
        // Pass 2: Merge { and { across simple tag boundaries
        // Example: ></span>{<span></span>{<span> → ></span>{{<span>
        result = result.replace(/>(\s*)\{(\s*)<\/([^>]+)>(\s*)<([^>]+)>(\s*)\{(\s*)</g, '>$1{{$7<');
        // Pass 3: Merge fieldName and } across tag boundaries
        // Example: >fieldName<\/span><span>}<\/span><span>}< → >fieldName}}<
        result = result.replace(/>([a-zA-Z_][a-zA-Z0-9_]*)(\s*)<\/([^>]+)>(\s*)<([^>]+)>(\s*)\}(\s*)<\/([^>]+)>(\s*)<([^>]+)>(\s*)\}(\s*)</g, '>$1}}$12<');
        // Pass 4: Merge {{ and fieldName across tag boundaries
        // Example: >\{\{<\/span><span>fieldName< → >\{\{fieldName<
        result = result.replace(/>\{\{(\s*)<\/([^>]+)>(\s*)<([^>]+)>(\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*)</g, '>{{$6$7<');
        // Pass 5: Simple merging within spans (no nested tags)
        result = result.replace(/(<span[^>]*>)\s*\{\s*(<\/span>\s*<span[^>]*>)\s*\{\s*(<\/span>\s*<span[^>]*>)\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*(<\/span>\s*<span[^>]*>)\s*\}\s*(<\/span>\s*<span[^>]*>)\s*\}\s*(<\/span>)/g, '$1{{$4}}$7');
        // Pass 6: Merge across single span boundary
        // Example: >{{</span><span>companyName}}< → >{{companyName}}<
        result = result.replace(/>(\{\{)(\s*)<\/span>(\s*)<span[^>]*>(\s*)([a-zA-Z_][a-zA-Z0-9_]*\}\})/g, '>{{$5');
        result = result.replace(/>(\{\{[a-zA-Z_][a-zA-Z0-9_]*)(\s*)<\/span>(\s*)<span[^>]*>(\s*)(\}\})/g, '>$1}}');
        // Pass 7: Handle formatted braces (braces wrapped in <strong>, <em>, etc.)
        // Example: ><strong>{</strong></span><span><strong>{</strong></span> → ><strong>{{</strong></span>
        result = result.replace(/>(<(strong|em|u)>)\{(<\/\2>)(\s*)<\/span>(\s*)<span[^>]*>(\s*)(<\2>)\{(<\/\2>)/g, '>$1{{$3');
        result = result.replace(/>(<(strong|em|u)>)\}(<\/\2>)(\s*)<\/span>(\s*)<span[^>]*>(\s*)(<\2>)\}(<\/\2>)/g, '>$1}}$3');
        // Pass 8: Merge formatted fieldName with braces
        // Example: ><strong>{{</strong></span><span><strong>fieldName</strong></span> → ><strong>{{fieldName</strong></span>
        result = result.replace(/>(<(strong|em|u)>)\{\{(<\/\2>)(\s*)<\/span>(\s*)<span[^>]*>(\s*)(<\2>)([a-zA-Z_][a-zA-Z0-9_]*)(<\/\2>)/g, '>$1{{$8$3');
        result = result.replace(/>(<(strong|em|u)>)([a-zA-Z_][a-zA-Z0-9_]*)\}\}(<\/\2>)(\s*)<\/span>(\s*)<span[^>]*>(\s*)(<\2>)([^<]*)(<\/\2>)/g, '>$1$3}}$4');
    }
    return result;
}
/**
 * Convert RTF document to HTML
 *
 * @param doc - RTF document AST
 * @param options - HTML rendering options
 * @returns HTML string
 *
 * @example
 * ```typescript
 * const doc = parseRTF('{\\rtf1\\b Bold text\\b0}');
 * const html = toHTML(doc);
 * console.log(html); // <div class="rtf-content"><p><strong>Bold text</strong></p></div>
 * ```
 *
 * @example Track changes modes
 * ```typescript
 * // Show visual markup (default)
 * const markup = toHTML(doc, { trackChanges: { mode: 'markup' } });
 *
 * // Show final result (as if all changes accepted)
 * const final = toHTML(doc, { trackChanges: { mode: 'final' } });
 *
 * // Show original (as if all changes rejected)
 * const original = toHTML(doc, { trackChanges: { mode: 'original' } });
 *
 * // Custom colors
 * const custom = toHTML(doc, {
 *   trackChanges: {
 *     insertionColor: '#e6ffe6',
 *     deletionColor: '#ffe6e6'
 *   }
 * });
 * ```
 */
export function toHTML(doc, options) {
    const opts = {
        includeWrapper: true,
        ...options,
    };
    // Merge track changes options with defaults using nullish coalescing
    // to properly handle explicitly passed undefined values
    const trackChangesOpts = {
        mode: opts.trackChanges?.mode ?? defaultTrackChangesOptions.mode,
        insertionColor: opts.trackChanges?.insertionColor ?? defaultTrackChangesOptions.insertionColor,
        deletionColor: opts.trackChanges?.deletionColor ?? defaultTrackChangesOptions.deletionColor,
        insertionBorderColor: opts.trackChanges?.insertionBorderColor ?? defaultTrackChangesOptions.insertionBorderColor,
        deletionBorderColor: opts.trackChanges?.deletionBorderColor ?? defaultTrackChangesOptions.deletionBorderColor,
        includeDataAttributes: opts.trackChanges?.includeDataAttributes ?? defaultTrackChangesOptions.includeDataAttributes,
        includeTooltips: opts.trackChanges?.includeTooltips ?? defaultTrackChangesOptions.includeTooltips,
    };
    // Render all content nodes
    let contentHTML = doc.content
        .map((node) => renderNode(node, doc, trackChangesOpts))
        .join('\n');
    // Reconstruct placeholder tokens (e.g., {{fieldName}}) from escaped braces
    contentHTML = reconstructPlaceholders(contentHTML);
    // Wrap in container div if requested
    if (opts.includeWrapper) {
        return `<div class="rtf-content">\n${contentHTML}\n</div>`;
    }
    return contentHTML;
}
//# sourceMappingURL=html.js.map