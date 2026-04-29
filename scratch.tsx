import Markdown from 'markdown-to-jsx';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const text = `
Liquid Psi
Psi that take a liquid form vary more so those who are solid.
-------------------------
`;

console.log(renderToStaticMarkup(React.createElement(Markdown, {
    options: {
        forceBlock: true
    }
}, text)));
