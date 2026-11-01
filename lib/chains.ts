// ---------------------------------------------------------------------------
// Every chain the tracker can read, and every token worth reading on it.
//
// There is no chain picker in the UI any more: an address is checked against
// every EVM chain here, because the same 0x address exists on all of them and
// only the balances say where the money actually is.
//
// Each address below was verified on chain on 2026-09-22 by calling symbol()
// and decimals() on the contract, and `decimals` is what the contract
// answered, not an assumption (BNB Chain's USDT is 18, not 6). A token whose
// symbol() did not match was dropped rather than guessed at. Tether's
// Arbitrum and Polygon contracts now answer "USDT0"/"USD\u20ae0" after their
// rename; those are the canonical addresses and are kept under the USDT name.
//
// `price` is where the USD price comes from: "cg:<id>" is CoinGecko,
// "yf:<symbol>" is the Yahoo chart API already used by /api/benchmark. Both
// key sets are closed, which is what keeps /api/wallets/prices from being an
// open proxy for arbitrary symbols.
// ---------------------------------------------------------------------------

export interface TokenSpec {
  symbol: string;
  address: string;
  decimals: number;
  price: string;
  // Tokenised equities are stocks, not crypto, and belong in that slice of the
  // allocation chart.
  category?: "stocks";
  name?: string;
}

export interface EvmChain {
  id: string;
  label: string;
  chainId: number;
  rpc: string;
  native: { symbol: string; price: string };
  tokens: TokenSpec[];
}

export const EVM_CHAINS: EvmChain[] = [
  {
    id: "ethereum",
    label: "Ethereum",
    chainId: 1,
    rpc: "https://ethereum-rpc.publicnode.com",
    native: { symbol: "ETH", price: "cg:ethereum" },
    tokens: [
      { symbol: "DAI", address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", decimals: 18, price: "cg:dai" },
      { symbol: "USDC", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6, price: "cg:usd-coin" },
      { symbol: "USDT", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6, price: "cg:tether" },
      { symbol: "WBTC", address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", decimals: 8, price: "cg:bitcoin" },
      { symbol: "WETH", address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18, price: "cg:ethereum" },
    ],
  },
  {
    id: "base",
    label: "Base",
    chainId: 8453,
    rpc: "https://base-rpc.publicnode.com",
    native: { symbol: "ETH", price: "cg:ethereum" },
    tokens: [
      { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6, price: "cg:usd-coin" },
      { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18, price: "cg:ethereum" },
      { symbol: "cbBTC", address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", decimals: 8, price: "cg:bitcoin" },
    ],
  },
  {
    id: "arbitrum",
    label: "Arbitrum",
    chainId: 42161,
    rpc: "https://arbitrum-one-rpc.publicnode.com",
    native: { symbol: "ETH", price: "cg:ethereum" },
    tokens: [
      { symbol: "DAI", address: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", decimals: 18, price: "cg:dai" },
      { symbol: "USDC", address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6, price: "cg:usd-coin" },
      { symbol: "USDT", address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6, price: "cg:tether" },
      { symbol: "WBTC", address: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f", decimals: 8, price: "cg:bitcoin" },
      { symbol: "WETH", address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", decimals: 18, price: "cg:ethereum" },
    ],
  },
  {
    id: "optimism",
    label: "Optimism",
    chainId: 10,
    rpc: "https://optimism-rpc.publicnode.com",
    native: { symbol: "ETH", price: "cg:ethereum" },
    tokens: [
      { symbol: "DAI", address: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", decimals: 18, price: "cg:dai" },
      { symbol: "USDC", address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", decimals: 6, price: "cg:usd-coin" },
      { symbol: "USDT", address: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", decimals: 6, price: "cg:tether" },
      { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18, price: "cg:ethereum" },
    ],
  },
  {
    id: "polygon",
    label: "Polygon",
    chainId: 137,
    rpc: "https://polygon-bor-rpc.publicnode.com",
    native: { symbol: "POL", price: "cg:polygon-ecosystem-token" },
    tokens: [
      { symbol: "DAI", address: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063", decimals: 18, price: "cg:dai" },
      { symbol: "USDC", address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6, price: "cg:usd-coin" },
      { symbol: "USDT", address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", decimals: 6, price: "cg:tether" },
      { symbol: "WBTC", address: "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6", decimals: 8, price: "cg:bitcoin" },
      { symbol: "WETH", address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", decimals: 18, price: "cg:ethereum" },
    ],
  },
  {
    id: "bsc",
    label: "BNB Chain",
    chainId: 56,
    rpc: "https://bsc-rpc.publicnode.com",
    native: { symbol: "BNB", price: "cg:binancecoin" },
    tokens: [
      { symbol: "BTCB", address: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c", decimals: 18, price: "cg:bitcoin" },
      { symbol: "ETH", address: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8", decimals: 18, price: "cg:ethereum" },
      { symbol: "USDC", address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18, price: "cg:usd-coin" },
      { symbol: "USDT", address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18, price: "cg:tether" },
    ],
  },
  {
    id: "avalanche",
    label: "Avalanche",
    chainId: 43114,
    rpc: "https://avalanche-c-chain-rpc.publicnode.com",
    native: { symbol: "AVAX", price: "cg:avalanche-2" },
    tokens: [
      { symbol: "USDC", address: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", decimals: 6, price: "cg:usd-coin" },
      { symbol: "USDT", address: "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7", decimals: 6, price: "cg:tether" },
      { symbol: "WAVAX", address: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", decimals: 18, price: "cg:avalanche-2" },
    ],
  },
  {
    id: "robinhood",
    label: "Robinhood Chain",
    chainId: 4663,
    rpc: "https://rpc.mainnet.chain.robinhood.com",
    native: { symbol: "ETH", price: "cg:ethereum" },
    tokens: [
      { symbol: "USDG", address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", decimals: 6, price: "cg:global-dollar" },
      { symbol: "WETH", address: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73", decimals: 18, price: "cg:ethereum" },
      { symbol: "AAPL", address: "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9", decimals: 18, price: "yf:AAPL", category: "stocks", name: "Apple" },
      { symbol: "AMD", address: "0x86923f96303d656e4aa86d9d42d1e57ad2023fdc", decimals: 18, price: "yf:AMD", category: "stocks", name: "AMD" },
      { symbol: "AMZN", address: "0x12f190a9f9d7d37a250758b26824b97ce941bf54", decimals: 18, price: "yf:AMZN", category: "stocks", name: "Amazon" },
      { symbol: "AVGO", address: "0x156e175dd063a8ce274c50654ef40e0032b3fbcf", decimals: 18, price: "yf:AVGO", category: "stocks", name: "Broadcom" },
      { symbol: "BA", address: "0x4d21483a44bf67a86b77e3da301411880797d452", decimals: 18, price: "yf:BA", category: "stocks", name: "Boeing" },
      { symbol: "COIN", address: "0x6330d8c3178a418788df01a47479c0ce7ccf450b", decimals: 18, price: "yf:COIN", category: "stocks", name: "Coinbase" },
      { symbol: "COST", address: "0x4ea005168d7f09a7a0ba9d1def21a479950e44c2", decimals: 18, price: "yf:COST", category: "stocks", name: "Costco" },
      { symbol: "CRM", address: "0xd95b44124e475743a7589e68f3d74008a5536d44", decimals: 18, price: "yf:CRM", category: "stocks", name: "Salesforce" },
      { symbol: "F", address: "0x25c288e6d899b9bc30160965ad9644c67e73be0c", decimals: 18, price: "yf:F", category: "stocks", name: "Ford Motor" },
      { symbol: "GME", address: "0x1b0e319c6a659f002271b69db8a7df2f911c153e", decimals: 18, price: "yf:GME", category: "stocks", name: "GameStop" },
      { symbol: "GOOGL", address: "0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3", decimals: 18, price: "yf:GOOGL", category: "stocks", name: "Alphabet Class A" },
      { symbol: "INTC", address: "0xc72b96e0e48ecd4dc75e1e45396e26300bc39681", decimals: 18, price: "yf:INTC", category: "stocks", name: "Intel" },
      { symbol: "JNJ", address: "0x03dfbbe0ac4e7bcdafd08ed41a400326b77d8c80", decimals: 18, price: "yf:JNJ", category: "stocks", name: "Johnson & Johnson" },
      { symbol: "LLY", address: "0x8005d266423c7ea827372c9c864491e5786600ea", decimals: 18, price: "yf:LLY", category: "stocks", name: "Eli Lilly" },
      { symbol: "META", address: "0xc0d6457c16cc70d6790dd43521c899c87ce02f35", decimals: 18, price: "yf:META", category: "stocks", name: "Meta Platforms" },
      { symbol: "MSFT", address: "0xe93237c50d904957cf27e7b1133b510c669c2e74", decimals: 18, price: "yf:MSFT", category: "stocks", name: "Microsoft" },
      { symbol: "MSTR", address: "0xec262a75e413fafd0df80480274532c79d42da09", decimals: 18, price: "yf:MSTR", category: "stocks", name: "Strategy Inc." },
      { symbol: "MU", address: "0xff080c8ce2e5feadaca0da81314ae59d232d4afd", decimals: 18, price: "yf:MU", category: "stocks", name: "Micron Technology" },
      { symbol: "NFLX", address: "0xe0444ef8bf4ed74f74fd73686e2ddf4c1c5591e8", decimals: 18, price: "yf:NFLX", category: "stocks", name: "Netflix" },
      { symbol: "NVDA", address: "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec", decimals: 18, price: "yf:NVDA", category: "stocks", name: "NVIDIA" },
      { symbol: "ORCL", address: "0xb0992820e760d836549ba69bc7598b4af75dee03", decimals: 18, price: "yf:ORCL", category: "stocks", name: "Oracle" },
      { symbol: "PFE", address: "0x7066a64c24e4206cd62e83bf198c1e7eb361f51e", decimals: 18, price: "yf:PFE", category: "stocks", name: "Pfizer" },
      { symbol: "PLTR", address: "0x894e1ec2d74ffe5aef8dc8a9e84686accb964f2a", decimals: 18, price: "yf:PLTR", category: "stocks", name: "Palantir Technologies" },
      { symbol: "QCOM", address: "0x0f17206447090e464c277571124dd2688e48aea9", decimals: 18, price: "yf:QCOM", category: "stocks", name: "Qualcomm" },
      { symbol: "QQQ", address: "0xd5f3879160bc7c32ebb4dc785f8a4f505888de68", decimals: 18, price: "yf:QQQ", category: "stocks", name: "Invesco QQQ" },
      { symbol: "SHOP", address: "0xf53f66751b1eff985311b693531e3290f600c410", decimals: 18, price: "yf:SHOP", category: "stocks", name: "Shopify" },
      { symbol: "SPY", address: "0x117cc2133c37b721f49de2a7a74833232b3b4c0c", decimals: 18, price: "yf:SPY", category: "stocks", name: "SPDR S&P 500 ETF Trust" },
      { symbol: "TSLA", address: "0x322f0929c4625ed5bad873c95208d54e1c003b2d", decimals: 18, price: "yf:TSLA", category: "stocks", name: "Tesla" },
    ],
  },
];

// The two chains whose addresses are not 0x, so the address format alone says
// which one a string belongs to.
export const BITCOIN = { id: "bitcoin", label: "Bitcoin", symbol: "BTC", price: "cg:bitcoin" };
export const SOLANA = { id: "solana", label: "Solana", symbol: "SOL", price: "cg:solana" };

export const CHAIN_LABELS: Record<string, string> = {
  [BITCOIN.id]: BITCOIN.label,
  [SOLANA.id]: SOLANA.label,
  ...Object.fromEntries(EVM_CHAINS.map((c) => [c.id, c.label])),
};

// Every price key the registry can ask for. /api/wallets/prices refuses
// anything outside this set.
export const PRICE_KEYS: ReadonlySet<string> = new Set<string>([
  BITCOIN.price,
  SOLANA.price,
  ...EVM_CHAINS.flatMap((c) => [c.native.price, ...c.tokens.map((t) => t.price)]),
]);
