// "Close the month" in Media Plan Lab, done by the server: the same rules as archivePlan_,
// adminArchiveStatus and adminArchiveMove in Code.gs. A month moves to the archive tab only
// when every one of its days is there, and it is removed from the current tab only after
// the archive has been read back and matches row for row.
const { batchGet, a1, valuesUpdate, valuesClear, sheetsBatchUpdate, forgetMeta, fsGet, fsSet } = require('./google');
const { ACCOUNTS, normalizeAccountKey_, ssIdOf, openBook, optionalSheet, fmt, wallFromInstant, grid, forgetArchive } = require('./dash');

function lastValueRow(colA) {
  for (let i = colA.length - 1; i >= 0; i--) {
    const v = (colA[i] || [])[0];
    if (v !== '' && v !== null && v !== undefined) return i + 1;
  }
  return 0;
}

function dayKey(v, asDate) {
  if (typeof v === 'number') { const d = asDate(v); return isFinite(d.getTime()) ? fmt(d, 'yyyy-MM-dd') : ''; }
  const m = String(v || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[1] + '-' + m[2] + '-' + m[3] : '';
}

async function archivePlan(account) {
  forgetMeta(ssIdOf(account.spreadsheetUrl)); // fresh tab sizes before writing
  const book = await openBook(account);
  const src = await optionalSheet(book, account.sheets.thisYear ? 'thisYear' : 'currentMonth');
  const dst = await optionalSheet(book, account.sheets.archive ? 'archive' : 'lastYear');
  if (!src || !dst) throw new Error('The current month tab or the archive tab is not linked for ' + account.label + '.');
  if (src.sheetId === dst.sheetId) throw new Error('The current month tab and the archive point to the same tab.');

  const [srcCol, dstCol] = await batchGet(book.id, [a1(src.title, 'A:A'), a1(dst.title, 'A:A')]);
  const srcLast = lastValueRow(srcCol);
  const dstLast = lastValueRow(dstCol);
  const srcRows = srcLast >= 2 ? grid((await batchGet(book.id, [a1(src.title, `A2:J${srcLast}`)]))[0], srcLast - 1, 10) : [];
  const archived = {};
  for (let i = 1; i < dstLast; i++) {
    const k = dayKey((dstCol[i] || [])[0], book.asDate).slice(0, 7);
    if (k) archived[k] = true;
  }

  const groups = {};
  srcRows.forEach((r, i) => {
    const dk = dayKey(r[0], book.asDate);
    if (!dk) return;
    const k = dk.slice(0, 7);
    const g = groups[k] || (groups[k] = { idx: [], days: {} });
    g.idx.push(i);
    g.days[dk] = true;
  });

  const thisMonth = fmt(wallFromInstant(Date.now(), book.tz), 'yyyy-MM');
  const months = Object.keys(groups).sort().map(k => {
    const p = k.split('-').map(Number);
    const need = new Date(Date.UTC(p[0], p[1], 0)).getUTCDate();
    const have = Object.keys(groups[k].days).length;
    const missing = [];
    for (let d = 1; d <= need; d++) if (!groups[k].days[k + '-' + String(d).padStart(2, '0')]) missing.push(d);
    const status = archived[k] ? 'archived' : k >= thisMonth ? 'running' : missing.length ? 'missing' : 'ready';
    return { key: k, have, need, rows: groups[k].idx.length, missing, status };
  });
  return { book, src, dst, srcRows, dstLast, groups, months, sourceName: src.title, archiveName: dst.title, archiveRows: Math.max(0, dstLast - 1) };
}

async function archiveStatus(accountKey) {
  const plan = await archivePlan(ACCOUNTS[normalizeAccountKey_(accountKey)]);
  return { months: plan.months, sourceName: plan.sourceName, archiveName: plan.archiveName, archiveRows: plan.archiveRows };
}

// One move at a time, across server instances.
const LOCK = 'server/archiveLock';
const LOCK_MS = 3 * 60 * 1000;

async function archiveMove(accountKey, who) {
  const account = ACCOUNTS[normalizeAccountKey_(accountKey)];
  const lock = await fsGet(LOCK);
  if (lock && Date.now() - lock.at < LOCK_MS) throw new Error('Another move is running. Please try again in a minute.');
  await fsSet(LOCK, { at: Date.now(), by: who.email });
  try {
    const plan = await archivePlan(account);
    const ready = plan.months.filter(m => m.status === 'ready');
    if (!ready.length) return { moved: [], rows: 0, months: plan.months, archiveRows: plan.archiveRows };

    const rows = [], moved = {};
    ready.forEach(m => plan.groups[m.key].idx.forEach(i => { rows.push(plan.srcRows[i]); moved[i] = true; }));
    const { book, src, dst } = plan;
    const start = Math.max(plan.dstLast, 1) + 1;
    const end = start + rows.length - 1;

    if (dst.rows < end) await sheetsBatchUpdate(book.id, [{ appendDimension: { sheetId: dst.sheetId, dimension: 'ROWS', length: end - dst.rows } }]);
    await valuesUpdate(book.id, a1(dst.title, `A${start}:J${end}`), rows);
    if (plan.dstLast >= 2) {
      // The new rows take the look of the archive's last row (dates, money), like PASTE_FORMAT.
      await sheetsBatchUpdate(book.id, [{ copyPaste: {
        source: { sheetId: dst.sheetId, startRowIndex: plan.dstLast - 1, endRowIndex: plan.dstLast, startColumnIndex: 0, endColumnIndex: 10 },
        destination: { sheetId: dst.sheetId, startRowIndex: start - 1, endRowIndex: end, startColumnIndex: 0, endColumnIndex: 10 },
        pasteType: 'PASTE_FORMAT'
      } }]);
    }

    const written = grid((await batchGet(book.id, [a1(dst.title, `A${start}:J${end}`)]))[0], rows.length, 10);
    const same = written.every((r, i) => r.every((v, j) => String(v) === String(rows[i][j])));
    if (!same) throw new Error('The archive did not save every row, so nothing was removed from ' + src.title + '.');

    const keep = plan.srcRows.filter((r, i) => !moved[i] && r.some(v => v !== '' && v !== null));
    await valuesClear(book.id, a1(src.title, `A2:J${plan.srcRows.length + 1}`));
    if (keep.length) await valuesUpdate(book.id, a1(src.title, `A2:J${keep.length + 1}`), keep);

    forgetArchive();
    console.log(who.email + ' moved ' + rows.length + ' rows (' + ready.map(m => m.key).join(', ') + ') to the archive.');
    const after = await archivePlan(account);
    return { moved: ready.map(m => m.key), rows: rows.length, startRow: start, months: after.months, archiveRows: after.archiveRows };
  } finally {
    await fsSet(LOCK, { at: 0 }).catch(() => {});
  }
}

module.exports = { archiveStatus, archiveMove };
