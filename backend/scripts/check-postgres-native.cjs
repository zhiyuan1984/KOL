#!/usr/bin/env node
/* Release-time verification only: this checker never connects to a database. */
const ts = require("typescript");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const cfg = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
if (cfg.error) throw new Error(ts.flattenDiagnosticMessageText(cfg.error.messageText, "\n"));
const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, root);
const program = ts.createProgram(parsed.fileNames, parsed.options);
const checker = program.getTypeChecker();
const issues = [];
function canonical(file) {
  const normalized = path.resolve(file).replace(/\\/g, "/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
const runtimeRoots = [canonical(path.join(root, "src")) + "/", canonical(path.join(root, "mcp")) + "/"];
const isRuntime = file => runtimeRoots.some(prefix => canonical(file).startsWith(prefix));
function add(sf, node, kind, text) {
  const position = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  issues.push({ file: path.relative(root, sf.fileName), line: position.line + 1, column: position.character + 1, kind, text });
}
function promised(type) {
  if (type.isUnion()) return type.types.some(promised);
  try { return Boolean(checker.getPromisedTypeOfPromise(type)); } catch { return false; }
}
function unresolvedProjection(type) {
  if (type.isUnion()) return type.types.some(unresolvedProjection);
  if (promised(type)) return true;
  if (checker.isArrayType(type) || checker.isTupleType(type))
    return checker.getTypeArguments(type).some(unresolvedProjection);
  return false;
}
function localSymbol(node) {
  let symbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(node) ? node.name : node);
  if (!symbol) return false;
  if (symbol.flags & ts.SymbolFlags.Alias) {
    try { symbol = checker.getAliasedSymbol(symbol); } catch { return false; }
  }
  return (symbol.declarations || []).some(declaration => isRuntime(declaration.getSourceFile().fileName));
}
function legacyParameter(text) {
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    if (text[index] === "'") {
      if (quoted && text[index + 1] === "'") { index++; continue; }
      quoted = !quoted;
    }
    if (text[index] !== "?" || quoted) continue;
    // PostgreSQL's JSONB ?, ?| and ?& operators are native SQL, not placeholders.
    if (text[index + 1] === "|" || text[index + 1] === "&") continue;
    const next = text.slice(index + 1).trimStart();
    if (/^(?:\$\d+|'|ARRAY\b|[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)/i.test(next)) continue;
    return true;
  }
  return false;
}
for (const sf of program.getSourceFiles()) {
  if (!isRuntime(sf.fileName) || !/\.tsx?$/.test(sf.fileName)) continue;
  function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
      && /(?:^|\/)db\.js$|postgres\/(?:sync|sqlite-migration)\.js$/.test(node.moduleSpecifier.text)) {
      add(sf, node, "retired-import", node.moduleSpecifier.text);
    }
    if (ts.isIdentifier(node) && ["getConn", "SqliteConn", "SqliteStmt", "PostgresSyncConn", "translateSqliteSql", "txImmediate"].includes(node.text)) {
      add(sf, node, "retired-symbol", node.text);
    }
    if (ts.isStringLiteral(node) && /better-sqlite3|node:sqlite/.test(node.text)) {
      add(sf, node, "sqlite-driver", node.text);
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      const text = node.text;
      const sqlStart = /^\s*(?:SELECT\b|INSERT\b|UPDATE\b|DELETE\b|WITH\b|WHERE\b|AND\b|OR\b|[a-z_][a-z0-9_.]*\s*[=<>])/i.test(text);
      const sqlShape = /\b(?:FROM|JOIN|VALUES|SET|EXISTS|LIKE|ILIKE)\b|[=<>]|\bIN\s*\(/i.test(text);
      if (sqlStart && sqlShape && legacyParameter(text)) add(sf, node, "legacy-sql-fragment", text.slice(0, 180));
      if (text === "?" && node.parent && ts.isArrowFunction(node.parent)) add(sf, node, "legacy-parameter-generator", text);
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const name = node.expression.name.text;
      if (name === "json" && node.arguments[0] && unresolvedProjection(checker.getTypeAtLocation(node.arguments[0])))
        add(sf, node, "unresolved-json-projection", node.getText(sf).slice(0, 200));
      if (ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "Promise"
        && ["race", "any", "all", "allSettled"].includes(name) && node.arguments[0]) {
        let values = node.arguments[0];
        while (ts.isParenthesizedExpression(values)) values = values.expression;
        if (ts.isArrayLiteralExpression(values)) {
          for (const value of values.elements) {
            let operand = value;
            while (ts.isParenthesizedExpression(operand)) operand = operand.expression;
            if (ts.isAwaitExpression(operand)) add(sf, operand, "preawaited-concurrency-operand", operand.getText(sf).slice(0, 200));
          }
        }
      }
      if (["filter", "find", "some", "every", "sort", "findIndex", "forEach"].includes(name) && node.arguments[0]) {
        const signatures = checker.getTypeAtLocation(node.arguments[0]).getCallSignatures();
        if (signatures.some(signature => promised(checker.getReturnTypeOfSignature(signature)))) {
          add(sf, node, name === "forEach" ? "unawaited-async-iteration" : "async-predicate", node.getText(sf).slice(0, 200));
        }
      }
      if (["one", "many", "execute", "command", "query"].includes(name)) {
        const sql = node.arguments[0];
        if (sql && (ts.isStringLiteral(sql) || ts.isNoSubstitutionTemplateLiteral(sql))) {
          if (legacyParameter(sql.text)) add(sf, sql, "legacy-parameter", sql.text.slice(0, 180));
          if (/\b(?:PRAGMA|INSERT OR IGNORE|INSERT OR REPLACE|sqlite_master|BEGIN IMMEDIATE)\b/i.test(sql.text)) {
            add(sf, sql, "legacy-sql", sql.text.slice(0, 180));
          }
        }
      }
    }
    if (ts.isExpressionStatement(node)) {
      let expression = node.expression;
      while (ts.isParenthesizedExpression(expression)) expression = expression.expression;
      if (ts.isCallExpression(expression) && promised(checker.getTypeAtLocation(expression)) && localSymbol(expression.expression)) {
        add(sf, node, "discarded-promise", expression.getText(sf).slice(0, 180));
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
}
for (const retired of ["src/db.ts", "src/postgres/sync.ts", "src/postgres/sync-worker.mjs", "src/postgres/sqlite-driver.ts", "src/postgres/sqlite-migration.ts", "src/postgres-only-app.ts"]) {
  if (fs.existsSync(path.join(root, retired))) issues.push({ file: retired, kind: "retired-file" });
}
for (const manifest of ["package.json", "package-lock.json"]) {
  if (/"(?:@types\/)?better-sqlite3"/.test(fs.readFileSync(path.join(root, manifest), "utf8"))) {
    issues.push({ file: manifest, kind: "sqlite-dependency" });
  }
}
const result = { status: issues.length ? "blocked" : "pass", total: issues.length, issues };
if (process.argv[2]) fs.writeFileSync(path.resolve(process.argv[2]), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
process.exitCode = issues.length ? 1 : 0;
