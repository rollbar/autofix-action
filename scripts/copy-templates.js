const fs = require('fs');
const path = require('path');

async function copyDir(src, dest) {
  await fs.promises.mkdir(dest, {recursive: true});
  const entries = await fs.promises.readdir(src, {withFileTypes: true});
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else if (entry.isFile()) {
      await fs.promises.copyFile(srcPath, destPath);
    }
  }
}

async function main() {
  const src = path.join(__dirname, '..', 'templates');
  const dest = path.join(__dirname, '..', 'dist', 'templates');
  if (!fs.existsSync(src)) {
    return;
  }
  await copyDir(src, dest);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
