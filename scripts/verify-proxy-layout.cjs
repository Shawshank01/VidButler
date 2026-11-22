// Run with pnpm exec electron scripts/verify-proxy-layout.cjs
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { app, BrowserWindow } = require('electron');

const profile = mkdtempSync(join(tmpdir(), 'vidbutler-layout-'));
app.setPath('userData', profile);
process.on('exit', () => rmSync(profile, { recursive: true, force: true }));

app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false });
    await win.loadFile(join(__dirname, '../src/index.html'));
    const { debugger: devTools } = win.webContents;
    devTools.attach();
    const failures = [];

    for (const width of [260, 320, 480, 481, 700, 701, 800, 1280, 1920]) {
        await devTools.sendCommand('Emulation.setDeviceMetricsOverride', {
            width, height: 800, deviceScaleFactor: 1, mobile: false
        });
        const issues = await win.webContents.executeJavaScript(`(() => {
            const issues = [];
            const protocol = document.getElementById('proxyType');
            const address = document.getElementById('proxyAddress');
            const defaultAddress = address.defaultValue;
            const card = document.querySelector('.download-controls');
            const canvas = document.createElement('canvas').getContext('2d');
            const textFits = (field, text) => {
                const style = getComputedStyle(field);
                canvas.font = style.font;
                return canvas.measureText(text).width <= field.clientWidth -
                    parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
            };
            for (const mode of ['classic', 'ai']) {
                document.body.dataset.mode = mode;
                for (const type of ['socks5', 'http']) {
                    protocol.value = type;
                    if (!textFits(protocol, protocol.selectedOptions[0].text)) {
                        issues.push(mode + ': clipped ' + type + ' label');
                    }
                }
                for (const value of [defaultAddress, '[2001:db8:abcd:1234:5678:9abc:def0:1234]:65535', 'proxy-' + 'a'.repeat(57) + '.' + 'b'.repeat(63) + '.example.test:65535']) {
                    address.value = value;
                    const wraps = address.tagName === 'TEXTAREA' && address.scrollHeight <= address.clientHeight;
                    if ((!textFits(address, value) && !wraps) || address.scrollWidth > address.clientWidth) {
                        issues.push(mode + ': clipped address (' + value.length + ' characters)');
                    }
                    for (const field of [protocol, address]) {
                        const rect = field.getBoundingClientRect();
                        const bounds = card.getBoundingClientRect();
                        if (!rect.width || rect.left < bounds.left || rect.right > bounds.right || rect.right > innerWidth) {
                            issues.push(mode + ': ' + field.id + ' extends outside the card or viewport');
                        }
                    }
                }
            }
            address.value = defaultAddress;
            return issues;
        })()`);
        failures.push(...new Set(issues.map(issue => `${width}px ${issue}`)));
    }

    assert.deepEqual(failures, []);
    console.log('Proxy layout passed in Classic and AI modes from 260px to 1920px.');
}).then(() => app.exit(0), (error) => {
    console.error(error);
    app.exit(1);
});
