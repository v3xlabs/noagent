#!/usr/bin/env node

import { readFileSync, writeFileSync, readdirSync, statSync, lstatSync } from 'fs';
import { join, extname, relative, resolve } from 'path';
import { performance } from 'perf_hooks';

const DEFAULT_EXTS = ['.rs', '.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.yml', '.yaml', '.css', '.scss', '.html', '.vue', '.py', '.go', '.java', '.cpp', '.c', '.h'];

const DEFAULT_IGNORE_PATTERNS = [
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  'target',
  'vendor',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  'venv',
  'env',
  '.env',
  '.DS_Store',
  'Thumbs.db'
];

function parseArgs(argv) {
  const args = argv.slice(2);
  const config = {
    extensions: DEFAULT_EXTS,
    ignorePatterns: DEFAULT_IGNORE_PATTERNS,
    maxDepth: 50,
    dryRun: false,
    verbose: false,
    help: false,
    targetDir: process.cwd()
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      config.help = true;
    } else if (arg === '--dry-run' || arg === '-n') {
      config.dryRun = true;
    } else if (arg === '--verbose' || arg === '-v') {
      config.verbose = true;
    } else if (arg.startsWith('--ext=')) {
      config.extensions = arg
        .replace('--ext=', '')
        .split(',')
        .map(ext => ext.trim())
        .map(ext => (ext.startsWith('.') ? ext : `.${ext}`));
    } else if (arg.startsWith('--ignore=')) {
      const ignoreList = arg
        .replace('--ignore=', '')
        .split(',')
        .map(pattern => pattern.trim());
      config.ignorePatterns.push(...ignoreList);
    } else if (arg.startsWith('--max-depth=')) {
      config.maxDepth = parseInt(arg.replace('--max-depth=', ''), 10) || 50;
    } else if (!arg.startsWith('-')) {
      config.targetDir = resolve(arg);
    }
  }

  return config;
}

function showHelp() {
  console.log(`
noagent - File formatting utility

Usage: noagent [options] [directory]

Options:
  -h, --help              Show this help message
  -n, --dry-run           Show what would be changed without making changes
  -v, --verbose           Enable verbose output
  --ext=.js,.ts,...       Comma-separated list of file extensions to process
                          (default: ${DEFAULT_EXTS.join(',')})
  --ignore=pattern,...    Additional patterns to ignore
  --max-depth=50          Maximum directory depth to traverse (default: 50)

Examples:
  noagent                 Format files in current directory
  noagent src/            Format files in src directory
  noagent --ext=.js,.ts   Only format JavaScript and TypeScript files
  noagent --dry-run       Preview changes without applying them
  noagent --verbose       Show detailed output

Default ignored patterns: ${DEFAULT_IGNORE_PATTERNS.join(', ')}
`);
}

function shouldIgnore(filePath, basePath, ignorePatterns) {
  const relativePath = relative(basePath, filePath);
  const pathParts = relativePath.split('/');

  return ignorePatterns.some(pattern => {
    return pathParts.some(part => {
      if (pattern.includes('*')) {
        const regex = new RegExp(pattern.replace(/\*/g, '.*'));
        return regex.test(part);
      }
      return part === pattern || part.startsWith(pattern);
    });
  });
}

function walkDirectory(dir, config, visited = new Set(), depth = 0) {
  const files = [];

  if (depth > config.maxDepth) {
    if (config.verbose) {
      console.log(`Skipping ${dir}: max depth exceeded`);
    }
    return files;
  }

  try {
    const realPath = resolve(dir);

    // Prevent infinite loops from symlinks
    if (visited.has(realPath)) {
      if (config.verbose) {
        console.log(`Skipping ${dir}: already visited (symlink loop prevention)`);
      }
      return files;
    }
    visited.add(realPath);

    const entries = readdirSync(dir);

    for (const entry of entries) {
      const fullPath = join(dir, entry);

      if (shouldIgnore(fullPath, config.targetDir, config.ignorePatterns)) {
        if (config.verbose) {
          console.log(`Ignoring: ${relative(config.targetDir, fullPath)}`);
        }
        continue;
      }

      try {
        const lstat = lstatSync(fullPath);

        if (lstat.isSymbolicLink()) {
          // Handle symlinks carefully
          try {
            const stat = statSync(fullPath);
            if (stat.isDirectory()) {
              files.push(...walkDirectory(fullPath, config, visited, depth + 1));
            } else if (stat.isFile()) {
              files.push(fullPath);
            }
          } catch (symlinkError) {
            if (config.verbose) {
              console.log(`Skipping broken symlink: ${relative(config.targetDir, fullPath)}`);
            }
          }
        } else if (lstat.isDirectory()) {
          files.push(...walkDirectory(fullPath, config, visited, depth + 1));
        } else if (lstat.isFile()) {
          files.push(fullPath);
        }
      } catch (error) {
        if (config.verbose) {
          console.log(`Error accessing ${relative(config.targetDir, fullPath)}: ${error.message}`);
        }
      }
    }
  } catch (error) {
    if (config.verbose) {
      console.log(`Error reading directory ${dir}: ${error.message}`);
    }
  }

  return files;
}

function formatFileContent(content) {
  return content
    .split('\n')
    .map(line => line.replace(/[ \t]+$/g, '')) // trim trailing whitespace
    .join('\n')
    .replace(/\n*$/, '') + '\n'; // ensure exactly one trailing newline
}

function processFile(filePath, config) {
  try {
    const originalContent = readFileSync(filePath, 'utf8');
    const formattedContent = formatFileContent(originalContent);

    if (originalContent !== formattedContent) {
      if (config.dryRun) {
        console.log(`Would format: ${relative(config.targetDir, filePath)}`);
        return { processed: true, changed: true, written: false };
      } else {
        writeFileSync(filePath, formattedContent, 'utf8');
        if (config.verbose) {
          console.log(`Formatted: ${relative(config.targetDir, filePath)}`);
        }
        return { processed: true, changed: true, written: true };
      }
    } else {
      if (config.verbose) {
        console.log(`No changes: ${relative(config.targetDir, filePath)}`);
      }
      return { processed: true, changed: false, written: false };
    }
  } catch (error) {
    console.error(`Error processing ${relative(config.targetDir, filePath)}: ${error.message}`);
    return { processed: false, changed: false, written: false, error: error.message };
  }
}

function main() {
  const config = parseArgs(process.argv);

  if (config.help) {
    showHelp();
    return;
  }

  console.log(`noagent v0.0.2 - Formatting files in ${relative(process.cwd(), config.targetDir) || '.'}`);

  if (config.dryRun) {
    console.log('🔍 Dry run mode - no files will be modified');
  }

  const startTime = performance.now();

  try {
    const allFiles = walkDirectory(config.targetDir, config);
    const targetFiles = allFiles.filter(file =>
      config.extensions.includes(extname(file))
    );

    console.log(`Found ${targetFiles.length} files to process`);

    let stats = {
      processed: 0,
      changed: 0,
      errors: 0,
      written: 0
    };

    for (const file of targetFiles) {
      const result = processFile(file, config);
      if (result.processed) stats.processed++;
      if (result.changed) stats.changed++;
      if (result.written) stats.written++;
      if (result.error) stats.errors++;
    }

    const endTime = performance.now();
    const duration = (endTime - startTime).toFixed(2);

    console.log(`\n✅ Complete! Processed ${stats.processed} files in ${duration}ms`);
    console.log(`   📝 ${stats.changed} files needed formatting`);
    if (!config.dryRun) {
      console.log(`   💾 ${stats.written} files written`);
    }
    if (stats.errors > 0) {
      console.log(`   ❌ ${stats.errors} errors encountered`);
    }

  } catch (error) {
    console.error(`Fatal error: ${error.message}`);
    process.exit(1);
  }
}

// Run the main function
main();
