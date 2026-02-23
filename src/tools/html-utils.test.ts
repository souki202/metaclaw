import { htmlToText } from './html-utils.js';
import fs from 'fs';

const testHtml = `
<html>
  <head>
    <title>Test Page</title>
    <style>body { color: red; }</style>
  </head>
  <body>
    <header>
      <h1>Main Title</h1>
    </header>
    <nav>
      <ul>
        <li><a href="/">Home</a></li>
        <li><a href="/about">About</a></li>
      </ul>
    </nav>
    <main>
      <section>
        <h2>Section 1</h2>
        <p>This is a paragraph with <b>bold</b> and <i>italic</i> text.</p>
        <p>Another paragraph.<br>With a line break.</p>
      </section>
      <section>
        <h2>Section 2</h2>
        <div>Div 1</div>
        <div>Div 2</div>
        <table>
          <tr><td>Cell 1</td><td>Cell 2</td></tr>
          <tr><td>Cell 3</td><td>Cell 4</td></tr>
        </table>
      </section>
    </main>
    <footer>
      <p>&copy; 2026 Test</p>
    </footer>
    <script>alert('hello');</script>
  </body>
</html>
`;

const result = htmlToText(testHtml);
fs.writeFileSync('html-test-output.txt', result);
console.log('Test result written to html-test-output.txt');
