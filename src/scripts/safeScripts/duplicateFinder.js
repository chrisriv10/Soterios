'use strict';

const { findDuplicates, deleteFilesWithPaths } = require('../../core/duplicateFinder');

module.exports = async function duplicateFinder(args = {}, onProgress) {
  const { scanPath, deletePaths, paths, ...options } = args;

  if (deletePaths && Array.isArray(deletePaths)) {
    return deleteFilesWithPaths(deletePaths);
  }

  // Support both scanPath (single path) and paths (array) for flexibility
  const roots = scanPath ? [scanPath] : (paths ? (Array.isArray(paths) ? paths : [paths]) : undefined);
  return findDuplicates({ roots, ...options, onProgress });
};
