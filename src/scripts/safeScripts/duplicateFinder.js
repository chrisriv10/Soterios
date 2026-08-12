'use strict';

const { findDuplicates, deleteFilesWithPaths } = require('../../core/duplicateFinder');

module.exports = async function duplicateFinder(args = {}) {
  const { scanPath, deletePaths, paths, ...options } = args;

  if (deletePaths && Array.isArray(deletePaths)) {
    return deleteFilesWithPaths(deletePaths);
  }

  // Support both scanPath (single path) and paths (array) for flexibility
  const roots = scanPath ? [scanPath] : (paths ? (Array.isArray(paths) ? paths : [paths]) : undefined);
  const result = await findDuplicates({ roots, ...options });

  return {
    ...result,
    duplicateGroups: result.duplicateGroups.slice(0, 100)
  };
};