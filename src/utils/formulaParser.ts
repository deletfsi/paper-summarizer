/**
 * LaTeX Formula Parser
 * Extracts and parses LaTeX formulas from text
 */

export interface Formula {
  latex: string;
  type: 'inline' | 'display';
  position: {
    start: number;
    end: number;
  };
}

export interface ParsedFormulas {
  formulas: Formula[];
  plainText: string; // Text with formulas removed
}

/**
 * Regular expressions for matching LaTeX formulas
 */
const DISPLAY_PATTERN = /\$\$([\s\S]*?)\$\$/g;
const INLINE_PATTERN = /\$([^\$\n]+?)\$/g;

/**
 * Extract all LaTeX formulas from text
 * @param text - Input text containing LaTeX formulas
 * @returns ParsedFormulas object containing formulas and plain text
 */
export function extractFormulas(text: string): ParsedFormulas {
  const formulas: Formula[] = [];

  // Use a map to track positions that should be removed
  const formulaRanges: Array<{ start: number; end: number; latex: string; type: 'inline' | 'display' }> = [];

  // Extract display formulas ($$...$$)
  let match;
  const displayRegex = /\$\$([\s\S]*?)\$\$/g;
  while ((match = displayRegex.exec(text)) !== null) {
    formulaRanges.push({
      start: match.index,
      end: match.index + match[0].length,
      latex: match[1].trim(),
      type: 'display'
    });
  }

  // Extract inline formulas ($...$)
  // Need to be careful not to match $$ (display formula delimiters)
  const inlineRegex = /\$([^\$\n]+?)\$/g;
  while ((match = inlineRegex.exec(text)) !== null) {
    // Check if this is actually part of a display formula
    const isOverlapping = formulaRanges.some(
      range => match!.index >= range.start && match!.index < range.end
    );

    if (!isOverlapping) {
      formulaRanges.push({
        start: match.index,
        end: match.index + match[0].length,
        latex: match[1].trim(),
        type: 'inline'
      });
    }
  }

  // Sort ranges by start position
  formulaRanges.sort((a, b) => a.start - b.start);

  // Build formulas array and plain text
  for (const range of formulaRanges) {
    formulas.push({
      latex: range.latex,
      type: range.type,
      position: {
        start: range.start,
        end: range.end
      }
    });
  }

  // Build plain text by removing formulas
  let plainText = '';
  let lastEnd = 0;

  for (const range of formulaRanges) {
    // Add text before this formula
    plainText += text.slice(lastEnd, range.start);
    lastEnd = range.end;
  }

  // Add remaining text after last formula
  plainText += text.slice(lastEnd);

  return {
    formulas,
    plainText
  };
}

/**
 * LaTeX to Unicode symbol mappings
 */
const LATEX_TO_UNICODE: Record<string, string> = {
  // Greek letters
  '\\alpha': '\u03b1',
  '\\beta': '\u03b2',
  '\\gamma': '\u03b3',
  '\\delta': '\u03b4',
  '\\epsilon': '\u03b5',
  '\\varepsilon': '\u03b5',
  '\\zeta': '\u03b6',
  '\\eta': '\u03b7',
  '\\theta': '\u03b8',
  '\\vartheta': '\u03b8',
  '\\iota': '\u03b9',
  '\\kappa': '\u03ba',
  '\\lambda': '\u03bb',
  '\\mu': '\u03bc',
  '\\nu': '\u03bd',
  '\\xi': '\u03be',
  '\\pi': '\u03c0',
  '\\varpi': '\u03c0',
  '\\rho': '\u03c1',
  '\\varrho': '\u03c1',
  '\\sigma': '\u03c3',
  '\\varsigma': '\u03c3',
  '\\tau': '\u03c4',
  '\\upsilon': '\u03c5',
  '\\phi': '\u03c6',
  '\\varphi': '\u03c6',
  '\\chi': '\u03c7',
  '\\psi': '\u03c8',
  '\\omega': '\u03c9',

  // Uppercase Greek
  '\\Gamma': '\u0393',
  '\\Delta': '\u0394',
  '\\Theta': '\u0398',
  '\\Lambda': '\u039b',
  '\\Xi': '\u039e',
  '\\Pi': '\u03a0',
  '\\Sigma': '\u03a3',
  '\\Upsilon': '\u03a5',
  '\\Phi': '\u03a6',
  '\\Psi': '\u03a8',
  '\\Omega': '\u03a9',

  // Operators
  '\\times': '\u00d7',
  '\\div': '\u00f7',
  '\\pm': '\u00b1',
  '\\mp': '\u2213',
  '\\cdot': '\u00b7',
  '\\ast': '\u2217',
  '\\star': '\u22c6',
  '\\circ': '\u2218',
  '\\bullet': '\u2022',
  '\\oplus': '\u2295',
  '\\ominus': '\u2296',
  '\\otimes': '\u2297',
  '\\oslash': '\u2298',
  '\\odot': '\u2299',

  // Relations
  '\\leq': '\u2264',
  '\\le': '\u2264',
  '\\geq': '\u2265',
  '\\ge': '\u2265',
  '\\neq': '\u2260',
  '\\ne': '\u2260',
  '\\approx': '\u2248',
  '\\equiv': '\u2261',
  '\\cong': '\u2245',
  '\\sim': '\u223c',
  '\\simeq': '\u2243',
  '\\subset': '\u2282',
  '\\supset': '\u2283',
  '\\subseteq': '\u2286',
  '\\supseteq': '\u2287',
  '\\in': '\u2208',
  '\\notin': '\u2209',
  '\\ni': '\u220b',
  '\\perp': '\u22a5',
  '\\parallel': '\u2225',
  '\\prop': '\u221d',

  // Arrows
  '\\leftarrow': '\u2190',
  '\\rightarrow': '\u2192',
  '\\Rightarrow': '\u21d2',
  '\\Leftarrow': '\u21d0',
  '\\leftrightarrow': '\u2194',
  '\\Leftrightarrow': '\u21d4',
  '\\uparrow': '\u2191',
  '\\downarrow': '\u2193',
  '\\nearrow': '\u2197',
  '\\searrow': '\u2198',

  // Logic
  '\\forall': '\u2200',
  '\\exists': '\u2203',
  '\\nexists': '\u2204',
  '\\neg': '\u00ac',
  '\\lnot': '\u00ac',
  '\\land': '\u2227',
  '\\lor': '\u2228',
  '\\cap': '\u2229',
  '\\cup': '\u222a',

  // Sets
  '\\emptyset': '\u2205',
  '\\varnothing': '\u2205',
  '\\mathbb{N}': '\u2115',
  '\\mathbb{Z}': '\u2124',
  '\\mathbb{Q}': '\u211a',
  '\\mathbb{R}': '\u211d',
  '\\mathbb{C}': '\u2102',

  // Misc
  '\\infty': '\u221e',
  '\\partial': '\u2202',
  '\\nabla': '\u2207',
  '\\sum': '\u2211',
  '\\prod': '\u220f',
  '\\int': '\u222b',
  '\\oint': '\u222e',
  '\\sqrt': '\u221a',
  '\\dagger': '\u2020',
  '\\ddagger': '\u2021',

  // Brackets
  '\\langle': '\u2329',
  '\\rangle': '\u232a',
  '\\lceil': '\u2308',
  '\\rceil': '\u2309',
  '\\lfloor': '\u230a',
  '\\rfloor': '\u230b',

  // Functions
  '\\sin': 'sin',
  '\\cos': 'cos',
  '\\tan': 'tan',
  '\\log': 'log',
  '\\ln': 'ln',
  '\\exp': 'exp',
  '\\lim': 'lim',
  '\\max': 'max',
  '\\min': 'min',
  '\\sup': 'sup',
  '\\inf': 'inf',
};

/**
 * Convert basic LaTeX symbols to Unicode for display
 * @param latex - LaTeX formula string
 * @returns Unicode-formatted string
 */
export function formatFormulaForDisplay(latex: string): string {
  let result = latex;

  // Replace Greek letters first (single character Unicode)
  const greekMappings: Record<string, string> = {
    '\\alpha': '\u03b1', '\\beta': '\u03b2', '\\gamma': '\u03b3', '\\delta': '\u03b4',
    '\\epsilon': '\u03b5', '\\varepsilon': '\u03b5', '\\zeta': '\u03b6', '\\eta': '\u03b7',
    '\\theta': '\u03b8', '\\vartheta': '\u03b8', '\\iota': '\u03b9', '\\kappa': '\u03ba',
    '\\lambda': '\u03bb', '\\mu': '\u03bc', '\\nu': '\u03bd', '\\xi': '\u03be',
    '\\pi': '\u03c0', '\\varpi': '\u03c0', '\\rho': '\u03c1', '\\varrho': '\u03c1',
    '\\sigma': '\u03c3', '\\varsigma': '\u03c3', '\\tau': '\u03c4', '\\upsilon': '\u03c5',
    '\\phi': '\u03c6', '\\varphi': '\u03c6', '\\chi': '\u03c7', '\\psi': '\u03c8',
    '\\omega': '\u03c9',
    '\\Gamma': '\u0393', '\\Delta': '\u0394', '\\Theta': '\u0398', '\\Lambda': '\u039b',
    '\\Xi': '\u039e', '\\Pi': '\u03a0', '\\Sigma': '\u03a3', '\\Upsilon': '\u03a5',
    '\\Phi': '\u03a6', '\\Psi': '\u03a8', '\\Omega': '\u03a9',
  };

  for (const [cmd, unicode] of Object.entries(greekMappings)) {
    result = result.split(cmd).join(unicode);
  }

  // Replace operators
  const operatorMappings: Record<string, string> = {
    '\\times': '\u00d7', '\\div': '\u00f7', '\\pm': '\u00b1', '\\mp': '\u2213',
    '\\cdot': '\u00b7', '\\ast': '\u2217', '\\star': '\u22c6', '\\circ': '\u2218',
    '\\bullet': '\u2022', '\\oplus': '\u2295', '\\ominus': '\u2296', '\\otimes': '\u2297',
    '\\oslash': '\u2298', '\\odot': '\u2299',
  };

  for (const [cmd, unicode] of Object.entries(operatorMappings)) {
    result = result.split(cmd).join(unicode);
  }

  // Replace relations
  const relationMappings: Record<string, string> = {
    '\\leq': '\u2264', '\\le': '\u2264', '\\geq': '\u2265', '\\ge': '\u2265',
    '\\neq': '\u2260', '\\ne': '\u2260', '\\approx': '\u2248', '\\equiv': '\u2261',
    '\\cong': '\u2245', '\\sim': '\u223c', '\\simeq': '\u2243', '\\subset': '\u2282',
    '\\supset': '\u2283', '\\subseteq': '\u2286', '\\supseteq': '\u2287', '\\in': '\u2208',
    '\\notin': '\u2209', '\\ni': '\u220b', '\\perp': '\u22a5', '\\parallel': '\u2225',
    '\\prop': '\u221d',
  };

  for (const [cmd, unicode] of Object.entries(relationMappings)) {
    result = result.split(cmd).join(unicode);
  }

  // Replace arrows
  const arrowMappings: Record<string, string> = {
    '\\leftarrow': '\u2190', '\\rightarrow': '\u2192', '\\Rightarrow': '\u21d2',
    '\\Leftarrow': '\u21d0', '\\leftrightarrow': '\u2194', '\\Leftrightarrow': '\u21d4',
    '\\uparrow': '\u2191', '\\downarrow': '\u2193', '\\nearrow': '\u2197', '\\searrow': '\u2198',
  };

  for (const [cmd, unicode] of Object.entries(arrowMappings)) {
    result = result.split(cmd).join(unicode);
  }

  // Replace logic symbols
  const logicMappings: Record<string, string> = {
    '\\forall': '\u2200', '\\exists': '\u2203', '\\nexists': '\u2204', '\\neg': '\u00ac',
    '\\lnot': '\u00ac', '\\land': '\u2227', '\\lor': '\u2228', '\\cap': '\u2229', '\\cup': '\u222a',
  };

  for (const [cmd, unicode] of Object.entries(logicMappings)) {
    result = result.split(cmd).join(unicode);
  }

  // Replace misc symbols
  const miscMappings: Record<string, string> = {
    '\\infty': '\u221e', '\\partial': '\u2202', '\\nabla': '\u2207',
    '\\sum': '\u2211', '\\prod': '\u220f', '\\int': '\u222b', '\\oint': '\u222e',
    '\\sqrt': '\u221a', '\\dagger': '\u2020', '\\ddagger': '\u2021',
    '\\emptyset': '\u2205', '\\varnothing': '\u2205',
  };

  for (const [cmd, unicode] of Object.entries(miscMappings)) {
    result = result.split(cmd).join(unicode);
  }

  // Handle fractions {a \over b} or \frac{a}{b}
  result = result.replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '($1)/($2)');
  result = result.replace(/\{([^}]+)\\over([^}]+)\}/g, '($1)/($2)');

  // Handle superscript with braces
  result = result.replace(/\^{\{([^}]+)\}}/g, '^($1)');
  result = result.replace(/\^([^{])/g, '^($1)');

  // Handle subscript with braces
  result = result.replace(/_\{([^}]+)\}/g, '_($1)');
  result = result.replace(/_([^{])/g, '_($1)');

  // Handle ^T (transpose)
  result = result.replace(/\^T/g, 'ᵀ');

  // Clean up remaining braces
  result = result.replace(/\{/g, '(');
  result = result.replace(/\}/g, ')');

  // Handle spacing commands
  result = result.replace(/\\quad/g, ' ');
  result = result.replace(/\\qquad/g, '  ');
  result = result.replace(/\\,/g, ' ');
  result = result.replace(/\\:/g, ' ');
  result = result.replace(/\\;/g, ' ');
  result = result.replace(/\\ /g, ' ');
  result = result.replace(/\\hspace\{[^}]+\}/g, ' ');

  // Remove remaining LaTeX commands that don't have Unicode equivalents
  result = result.replace(/\\[a-zA-Z]+/g, '');

  // Clean up multiple spaces
  result = result.replace(/\s+/g, ' ').trim();

  return result;
}

/**
 * Extract formulas and return them formatted for LLM processing
 * @param text - Input text containing LaTeX formulas
 * @returns Object with formulas and metadata
 */
export function parseFormulasForLLM(text: string): {
  formulas: Formula[];
  plainText: string;
  formattedFormulas: string[];
} {
  const { formulas, plainText } = extractFormulas(text);

  const formattedFormulas = formulas.map(formula =>
    formatFormulaForDisplay(formula.latex)
  );

  return {
    formulas,
    plainText,
    formattedFormulas
  };
}
