import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    ValidationError,
    validateUrl,
    validateLang,
    validateFormatCode,
    validateFileHint,
    validateEnum,
    validateIntRange,
    validateTimestamp,
    validateBool
} from '../src/llm/validate.js';

test('validateUrl accepts http(s) URLs and trims', () => {
    assert.equal(validateUrl('  https://www.youtube.com/watch?v=abc  '), 'https://www.youtube.com/watch?v=abc');
    assert.equal(validateUrl('http://example.com/a'), 'http://example.com/a');
});

test('validateUrl rejects flags, other schemes, whitespace and non-strings', () => {
    for (const bad of [
        '--exec rm -rf /',
        '-o /etc/passwd',
        'file:///etc/passwd',
        'javascript:alert(1)',
        'https://a.com/x y',
        'https://a.com/\nfoo',
        '',
        'not a url',
        42,
        undefined
    ]) {
        assert.throws(() => validateUrl(bad), ValidationError, `should reject ${JSON.stringify(bad)}`);
    }
});

test('validateLang', () => {
    assert.equal(validateLang('en'), 'en');
    assert.equal(validateLang('zh-Hans'), 'zh-Hans');
    assert.equal(validateLang('en-orig'), 'en-orig');
    for (const bad of ['', '--all', 'en,fr', 'en*', 'a'.repeat(30), 5]) {
        assert.throws(() => validateLang(bad), ValidationError);
    }
});

test('validateFormatCode', () => {
    assert.equal(validateFormatCode('137+140'), '137+140');
    assert.equal(validateFormatCode('bestaudio'), 'bestaudio');
    for (const bad of ['-F', '--exec', 'a b', 'best;rm', '', '$(x)']) {
        assert.throws(() => validateFormatCode(bad), ValidationError);
    }
});

test('validateFileHint blocks path traversal', () => {
    assert.equal(validateFileHint('My Video [abc123].mp4'), 'My Video [abc123].mp4');
    for (const bad of ['../secret', 'a/b.mp4', 'a\\b.mp4', '..', '/etc/passwd', '']) {
        assert.throws(() => validateFileHint(bad), ValidationError);
    }
});

test('validateEnum / validateIntRange / validateBool', () => {
    assert.equal(validateEnum(undefined, ['a', 'b'], 'x', 'a'), 'a');
    assert.equal(validateEnum('b', ['a', 'b'], 'x'), 'b');
    assert.throws(() => validateEnum('c', ['a', 'b'], 'x'), ValidationError);
    assert.throws(() => validateEnum(undefined, ['a', 'b'], 'x'), ValidationError);

    assert.equal(validateIntRange(undefined, 1, 10, 'n'), undefined);
    assert.equal(validateIntRange(5, 1, 10, 'n'), 5);
    assert.throws(() => validateIntRange(11, 1, 10, 'n'), ValidationError);
    assert.throws(() => validateIntRange(1.5, 1, 10, 'n'), ValidationError);
    assert.throws(() => validateIntRange('5', 1, 10, 'n'), ValidationError);

    assert.equal(validateBool(undefined, 'p'), false);
    assert.equal(validateBool(true, 'p'), true);
    assert.throws(() => validateBool('yes', 'p'), ValidationError);
});

test('validateTimestamp normalizes seconds and clock times', () => {
    assert.equal(validateTimestamp('0', 'start_time'), 0);
    assert.equal(validateTimestamp(' 01:02.050 ', 'start_time'), 62.05);
    assert.equal(validateTimestamp('90:15', 'end_time'), 5415);
    assert.equal(validateTimestamp('1:02:03.456', 'end_time'), 3723.456);
    assert.equal(validateTimestamp('3723.456', 'end_time'), 3723.456);
    for (const bad of [undefined, 10, '', '-1', '1:60', '1:60:00', '1:00:60', '1:2:3:4', '0.0001', '1e3', '9999999999999999', 'inf', '1-2', '0 --exec']) {
        assert.throws(() => validateTimestamp(bad, 'end_time'), /"end_time" must be a non-negative timestamp/);
    }
});
