#!/usr/bin/env node

import { mkdirSync, readdirSync, copyFileSync, existsSync, writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const version = createRequire(import.meta.url)(join(__dirname, '../package.json')).version;
console.log(version)

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});


const question = (query) => new Promise((resolve) => rl.question(query, resolve));


function copyDir(src, dest, ignoreFiles = []) {
  mkdirSync(dest, { recursive: true });

  const entries = readdirSync(src, { withFileTypes: true });

  for (let entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    
    // Check if the current file path matches any in the ignore list
    const shouldIgnore = ignoreFiles.some(ignorePath => 
      join(src, entry.name) === join(src, ignorePath)
    );

    if (entry.isDirectory()) {
      // only ignore at top level
      copyDir(srcPath, destPath);
    } else if (shouldIgnore) {
      continue;
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

async function main() {
  try {
    
    const projectName = await question('Please enter your project name: ');

    if (!projectName.trim()) {
      console.error('Project name cannot be empty');
      process.exit(1);
    }

    const projectPath = join(process.cwd(), projectName);
    mkdirSync(projectPath, { recursive: true });

    const templatePath = join(__dirname, '../template');

    if (!existsSync(templatePath)) {
      console.error('Template directory not found');
      process.exit(1);
    }

    copyDir(templatePath, projectPath, ['package.json','capacitor.config.js']);

    const templatePackageJsonPath = join(templatePath, 'package.json');
    if (!existsSync(templatePackageJsonPath)) {
      console.error('Template package.json not found');
      process.exit(1);
    }

    let packageJsonContent = readFileSync(templatePackageJsonPath, 'utf8');
    packageJsonContent = packageJsonContent.replace(/PROJECT_NAME/g, projectName).replace(/RP_VERSION/g, version);

    writeFileSync(join(projectPath, 'package.json'), packageJsonContent);


    const templateCapacitorPath = join(templatePath, 'capacitor.config.js');
    if (!existsSync(templateCapacitorPath)) {
      console.error('Template capacitor.config.js not found');
      process.exit(1);
    }

    let capacitorContent = readFileSync(templateCapacitorPath, 'utf8');
    capacitorContent = capacitorContent.replace(/PROJECT_NAME/g, projectName);

    writeFileSync(join(projectPath, 'capacitor.config.js'), capacitorContent);

    console.log(`
Project ${projectName} created successfully!

To get started:
    cd ${projectName}
    npm i && npm i --prefix backend
    npm run dev:all
    `);

  } catch (error) {
    console.error('Error creating project:', error);
    console.error('Error details:', error.message);
    process.exit(1);
  } finally {
    rl.close();
  }
}

main();