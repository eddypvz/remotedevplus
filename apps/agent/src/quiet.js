// node:sqlite es estable en API pero sigue marcado como experimental, y Node
// lo avisa en cada arranque. Se silencia solo ese aviso, no todos.
const original = process.emitWarning;
process.emitWarning = (warning, ...rest) => {
  const text = String(warning?.message ?? warning);
  const name = typeof warning === 'object' ? warning?.name : rest[0];
  if (name === 'ExperimentalWarning' && /SQLite/i.test(text)) return;
  return original.call(process, warning, ...rest);
};
