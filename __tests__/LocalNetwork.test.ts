import { isLocalNetworkUrl } from '../src/LocalNetwork';

describe('isLocalNetworkUrl', () => {
  it('detects RFC1918 and loopback IPv4 addresses', () => {
    expect(isLocalNetworkUrl('http://192.168.1.50:1234/v1')).toBe(true);
    expect(isLocalNetworkUrl('http://10.0.0.5/v1')).toBe(true);
    expect(isLocalNetworkUrl('http://172.16.4.4:8080')).toBe(true);
    expect(isLocalNetworkUrl('http://172.31.255.1')).toBe(true);
    expect(isLocalNetworkUrl('http://127.0.0.1:8080')).toBe(true);
    expect(isLocalNetworkUrl('http://169.254.10.2')).toBe(true);
  });

  it('rejects public IPv4 addresses', () => {
    expect(isLocalNetworkUrl('http://172.32.0.1')).toBe(false);
    expect(isLocalNetworkUrl('http://8.8.8.8')).toBe(false);
    expect(isLocalNetworkUrl('https://192.168.1.1.example.com')).toBe(false);
  });

  it('detects loopback and unique-local IPv6 addresses', () => {
    expect(isLocalNetworkUrl('http://[::1]:8080')).toBe(true);
    expect(isLocalNetworkUrl('http://[fd00::1]:8080')).toBe(true);
    expect(isLocalNetworkUrl('http://[fe80::1]')).toBe(true);
  });

  it('detects local hostnames', () => {
    expect(isLocalNetworkUrl('http://localhost:8080')).toBe(true);
    expect(isLocalNetworkUrl('http://ollama:11434')).toBe(true);
    expect(isLocalNetworkUrl('http://server.local/v1')).toBe(true);
  });

  it('rejects public hosts and non-URLs', () => {
    expect(isLocalNetworkUrl('https://api.openai.com/v1')).toBe(false);
    expect(isLocalNetworkUrl('https://example.com')).toBe(false);
    expect(isLocalNetworkUrl("cat's api")).toBe(false);
    expect(isLocalNetworkUrl('')).toBe(false);
  });
});
