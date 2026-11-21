import { build } from 'esbuild';

await build({
  entryPoints: ['src/main.jsx'],
  outfile: 'public/app-react.js',
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2020'],
  sourcemap: false,
});
console.log('Built the PRMD City React client.');
