// Shared by Classic and AI mode; validation remains in the main process.
window.SharedContext = {
    getProxyUrl() {
        const enabled = document.getElementById('proxyEnabled');
        const input = document.getElementById('proxyAddress');
        const address = enabled?.checked && input ? input.value.trim() : '';
        const scheme = document.getElementById('proxyType')?.value === 'http' ? 'http' : 'socks5';
        return address ? `${scheme}://${address}/` : '';
    }
};
