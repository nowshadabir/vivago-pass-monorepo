const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const watch = process.argv.includes('--watch');

async function build() {
  const context = await esbuild.context({
    entryPoints: [
      'src/background.ts',
      'src/content.ts',
      'src/popup.ts',
    ],
    bundle: true,
    outdir: 'dist',
    minify: !watch,
    sourcemap: watch ? 'inline' : false,
    platform: 'browser',
    target: ['chrome100'],
    external: ['crypto'],
    loader: {
      '.ts': 'ts'
    }
  });

  // Copy static files
  if (!fs.existsSync('dist')) {
    fs.mkdirSync('dist');
  }
  
  const copyFile = (src, dest) => {
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
    }
  };

  copyFile('src/manifest.json', 'dist/manifest.json');
  copyFile('src/popup.html', 'dist/popup.html');
  copyFile('src/popup.css', 'dist/popup.css');
  copyFile('src/logo.jpg', 'dist/logo.jpg');

  copyFile('src/webauthn-bridge.js', 'dist/webauthn-bridge.js');
  if (watch) {
    await context.watch();
    console.log('Watching for changes...');
  } else {
    await context.rebuild();
    await context.dispose();
    console.log('Build completed successfully.');
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
