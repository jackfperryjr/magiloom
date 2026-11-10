import assert from 'node:assert/strict'
import { parseLichVersion, isNewer } from './lich-version'

assert.equal(parseLichVersion("LICH_VERSION = '5.20.0' # x-release-please-version"), '5.20.0')
assert.equal(parseLichVersion('# frozen_string_literal: true\n\nLICH_VERSION = "5.24.1"\n'), '5.24.1')
assert.equal(parseLichVersion('nothing here'), '')

assert.equal(isNewer('5.24.0', '5.20.0'), true)
assert.equal(isNewer('v5.24.0', '5.24.0'), false)
assert.equal(isNewer('5.10.0', '5.9.9'), true)    // numeric, not string, compare
assert.equal(isNewer('5.20.0', '5.24.0'), false)  // a local build ahead of the release
assert.equal(isNewer('5.24.0', '5.24.0-beta.1'), false)
assert.equal(isNewer('6.0', '5.99.99'), true)

console.log('lich-version: ok')
