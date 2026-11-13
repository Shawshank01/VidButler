import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedExternalUrl } from '../src/external-url.js';

test('web links and the macOS privacy settings pane may be opened', () => {
    assert.equal(isAllowedExternalUrl('https://github.com/Shawshank01/Vidbutler'), true);
    assert.equal(isAllowedExternalUrl('http://example.com/a?b=c'), true);
    assert.equal(isAllowedExternalUrl('  https://aistudio.google.com/apikey  '), true);
    assert.equal(
        isAllowedExternalUrl('x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_FilesAndFolders'),
        true
    );
    assert.equal(
        isAllowedExternalUrl('x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders'),
        true
    );
});

test('anything that could launch a program or read local files is refused', () => {
    for (const url of [
        'file:///Applications/Calculator.app',
        'javascript:alert(1)',
        'ms-msdt:/id PCWDiagnostic',
        'vscode://anything',
        'smb://server/share',
        'data:text/html,<script>1</script>',
        '/etc/passwd',
        'not a url',
        ''
    ]) {
        assert.equal(isAllowedExternalUrl(url), false, url);
    }
});

test('non-strings and oversized values are refused', () => {
    for (const value of [undefined, null, 42, {}, ['https://example.com']]) {
        assert.equal(isAllowedExternalUrl(value), false);
    }
    assert.equal(isAllowedExternalUrl(`https://example.com/${'a'.repeat(5000)}`), false);
});
