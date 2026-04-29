import Markdown from 'markdown-to-jsx';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const text = `Liquid Psi
Psi that take a liquid form vary...
-------------------------`;

let safeText = text.replace(/\n/g, '  \n');

console.log("Output:", renderToStaticMarkup(React.createElement(Markdown, {
    options: { forceBlock: true }
}, safeText)));
