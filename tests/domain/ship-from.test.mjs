// The eBay ship-from address (v3.28.19): city, state and ZIP only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanShipFrom, shipFromOfLocation, shipFromLine, isPlaceholderShipFrom, US_STATES } from '../../src/domain/ship-from.js';

test('a good address is trimmed and normalized, with no street', () => {
  const r = cleanShipFrom({ city: '  San   Antonio ', stateOrProvince: 'tx', postalCode: ' 78205 ' });
  assert.deepEqual(r, { ok: true, address: { city: 'San Antonio', stateOrProvince: 'TX', postalCode: '78205', country: 'US' } });
  assert.equal(cleanShipFrom({ city: "Coeur d'Alene", stateOrProvince: 'ID', postalCode: '83814-1234' }).ok, true);
  assert.equal(cleanShipFrom({ city: 'St. Louis', state: 'MO', zip: '63101' }).ok, true, 'state and zip are accepted too');
  assert.equal(cleanShipFrom({ city: 'winston-salem', stateOrProvince: 'NC', postalCode: '27101' }).address.city, 'Winston-Salem');
  assert.equal(cleanShipFrom({ city: 'McAllen', stateOrProvince: 'TX', postalCode: '78501' }).address.city, 'McAllen');
});

test('every field has its own message', () => {
  const r = cleanShipFrom({ city: '', stateOrProvince: 'XX', postalCode: '1234' });
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.errors).sort(), ['city', 'postalCode', 'state']);
  assert.equal(cleanShipFrom({ city: 'Austin<script>', stateOrProvince: 'TX', postalCode: '78701' }).errors.city.length > 0, true);
  assert.equal(cleanShipFrom({ city: 'Austin', stateOrProvince: 'TX', postalCode: '7870' }).ok, false);
  assert.equal(cleanShipFrom({ city: 'Austin', stateOrProvince: 'TX', postalCode: '787011' }).ok, false);
  assert.equal(cleanShipFrom(null).ok, false);
  assert.equal(cleanShipFrom('Austin TX').ok, false);
});

test('the state list is the 50 states and DC', () => {
  assert.equal(US_STATES.length, 51);
  assert.equal(new Set(US_STATES).size, 51);
  assert.ok(US_STATES.includes('DC'));
  assert.ok(!US_STATES.includes('PR'));
});

test('the address of an eBay location, and its line', () => {
  const loc = { merchantLocationKey: 'k', location: { address: { addressLine1: '1 X St', city: 'Austin', stateOrProvince: 'TX', postalCode: '78701', country: 'US' } } };
  const a = shipFromOfLocation(loc);
  assert.deepEqual(a, { city: 'Austin', stateOrProvince: 'TX', postalCode: '78701' }, 'the street is never passed on');
  assert.equal(shipFromLine(a), 'Austin, TX 78701');
  assert.equal(shipFromLine({ postalCode: '78701' }), '78701');
  assert.equal(shipFromOfLocation({}), null);
  assert.equal(shipFromOfLocation({ location: { address: {} } }), null);
  assert.equal(shipFromLine(null), '');
});

test('the old sample address is recognized', () => {
  assert.equal(isPlaceholderShipFrom({ city: 'Orlando', stateOrProvince: 'FL', postalCode: '32801' }), true);
  assert.equal(isPlaceholderShipFrom({ city: 'orlando', stateOrProvince: 'fl', postalCode: '32801-0000' }), true);
  assert.equal(isPlaceholderShipFrom({ city: 'Orlando', stateOrProvince: 'FL', postalCode: '32803' }), false);
  assert.equal(isPlaceholderShipFrom(null), false);
});
