// Shared by Classic and AI mode; validation remains in the main process.
window.SharedContext = {
    getProxyUrl() {
        const enabled = document.getElementById('proxyEnabled');
        const input = document.getElementById('proxyAddress');
        const address = enabled?.checked && input ? input.value.trim() : '';
        return address ? `socks5://${address}/` : '';
    }
};
