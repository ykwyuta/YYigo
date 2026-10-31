/*
 * いきがみえる囲碁 — CPU の思考を別スレッドで動かす（画面が固まらないように）
 */
/* global importScripts, AI */
importScripts('rules.js', 'ai.js');
self.onmessage = e => {
  const { id, kind, st, level } = e.data;
  st.board = Int8Array.from(st.board);
  let result;
  if (kind === 'dead') result = AI.guessDead(st);
  else if (kind === 'own') result = Array.from(AI.ownership(st, 800));
  else result = AI.think(st, level);
  self.postMessage({ id, result });
};
