export function htmlToText(html: string): string {
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  // Replace block tags with newlines to preserve structure
  const blockTags = [
    'div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 
    'li', 'br', 'hr', 'tr', 'header', 'footer', 'section', 'article', 'aside', 'main', 'nav', 'ul', 'ol', 'table', 'blockquote',
    'thead', 'tbody', 'tfoot', 'pre', 'address', 'figure', 'figcaption', 'dl', 'dt', 'dd'
  ];
  
  // Replace opening and closing block tags with newlines
  const blockRegex = new RegExp(`</?\\b(${blockTags.join('|')})\\b[^>]*>`, 'gi');
  text = text.replace(blockRegex, '\n');

  // Strip all remaining tags
  text = text.replace(/<[^>]+>/g, ' ');

  // Clean up whitespace
  return text
    .replace(/[ \t]+/g, ' ')             // Collapse multiple spaces/tabs
    .replace(/\n\s*\n\s*\n+/g, '\n\n')   // Limit consecutive newlines to 2
    .trim();
}
