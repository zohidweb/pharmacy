#!/usr/bin/env node
// The load generator of one scenario (profile, hot, stress), run by run.mjs in a container of the Node image on the
// network of the API: the loopback of a Windows PC caps a client at a few hundred requests a second and adds tens of
// milliseconds under concurrency, inside the network of Docker the same API answers a trivial route 6 000 times a
// second. The input — the fleet with its cookies, the snapshots, the terms — comes on stdin (no file); the stream
// statistics go to stdout as JSON.
import { hot, profile, stress } from './scenarios.mjs';
import { sellable } from './receipts.mjs';

let text = '';
for await (const chunk of process.stdin) text += chunk;
const input = JSON.parse(text);
const fleet = { ...input.fleet, snapshots: new Map(Object.entries(input.fleet.snapshots)) };
const lists = new Map([...fleet.snapshots].map(([storeId, snapshot]) => [storeId, sellable(snapshot)]));
const run = { profile, hot, stress }[input.scenario](input.api, fleet, {
  sellable: lists,
  terms: input.terms,
  hotProductId: input.hotProductId,
  seconds: input.seconds,
  factor: input.factor ?? 1,
});
const streams = await run.streams;
process.stdout.write(
  JSON.stringify({ streams, receipts: { numbers: run.receipts.numbers.size, pieces: run.receipts.pieces() } }),
);
