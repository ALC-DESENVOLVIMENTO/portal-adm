import test from "node:test";
import assert from "node:assert/strict";
import { DRIVER_REGISTRY_SOURCE_COLUMNS, driverRegistrySourceProjection } from "./driver-registry-source-sql.js";

test("UNION de cadastros alinha colunas por nome, independentemente da ordem física", () => {
  const approved = driverRegistrySourceProjection("approved");
  const legacy = driverRegistrySourceProjection("legacy_current");
  assert.equal(DRIVER_REGISTRY_SOURCE_COLUMNS.length, 26);
  assert.equal(DRIVER_REGISTRY_SOURCE_COLUMNS[16], "data_nascimento");
  assert.equal(DRIVER_REGISTRY_SOURCE_COLUMNS[19], "placa");
  assert.equal(DRIVER_REGISTRY_SOURCE_COLUMNS[25], "validade_gr");
  assert.equal(approved.replaceAll("approved.", ""), legacy.replaceAll("legacy_current.", ""));
  assert.doesNotMatch(legacy, /\*/);
  assert.throws(() => driverRegistrySourceProjection("legacy;drop"));
});
