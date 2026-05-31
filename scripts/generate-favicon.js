#!/usr/bin/env node
'use strict';

const {createCanvas} = require('canvas');
const fs = require('fs');
const path = require('path');

const SIZE = 256;
const canvas = createCanvas(SIZE, SIZE);
const ctx = canvas.getContext('2d');

ctx.fillStyle = '#002a5c';
ctx.fillRect(0, 0, SIZE, SIZE);

ctx.fillStyle = '#fff';
ctx.font = 'bold 96px sans-serif';
ctx.textAlign = 'center';
ctx.textBaseline = 'middle';
ctx.fillText('YSH', SIZE / 2, SIZE / 2);

fs.writeFileSync(
    path.join(__dirname, '../public/favicon.png'),
    canvas.toBuffer('image/png')
);

console.log('public/favicon.png written');
