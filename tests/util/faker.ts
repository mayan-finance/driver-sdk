import { MayanEndpoints } from "../../src/config/endpoints";
import { GlobalConfig, SwiftFeeParams } from "../../src/config/global";
import { ExpenseParams, SwiftCosts } from "../../src/utils/fees";
import { Token } from "../../src/config/tokens";
import { Swap } from "../../src/swap.dto";
import Decimal from "decimal.js";
import { Keypair } from "@solana/web3.js";

export function fakeEndPoints(
  params?: Partial<MayanEndpoints>,
): MayanEndpoints {
  return {
    explorerWsAddress: "",
    relayerWsAddress: "",
    explorerApiUrl: "",
    priceApiUrl: "",
    lutApiUrl: "",
    refreshTokenIntervalSeconds: 0,
    ...params,
  };
}

export function fakeSwiftFeeParams(
  params?: Partial<SwiftFeeParams>,
): SwiftFeeParams {
  return {
    shrinkedStateCost: 0,
    sourceStateCost: 0,
    solanaSimpleCost: 0,
    postAuctionCost: 0,
    ataCreationCost: 0,
    postCancelCost: 0,
    batchPostBaseCost: 0,
    batchPostAdddedCost: 0,
    postUnlockVaaSingle: 0,
    postUnlockVaaBase: 0,
    postUnlockVaaPerItem: 0,
    solTxCost: 0,
    additionalSolfulfillCost: 0,

    auctionVaaVerificationAddedGas: 0,
    baseFulfillGasWithBatchEth: 0,
    baseFulfillGasWithOutBatchEth: 0,
    erc20GasOverHead: 0,
    swapFulfillAddedGas: 0,
    baseCancelGas: 0,
    baseBatchPostGas: 0,
    ethSubmitGas: 0,
    erc20SubmitGas: 0,
    ...params,
  };
}

export function fakeGlobalConfig(
  feeParams: SwiftFeeParams,
  params?: Partial<GlobalConfig>,
): GlobalConfig {
  return {
    ignoreReferrers: new Set(),
    blackListedReferrerAddresses: new Set(),
    whiteListedReferrerAddresses: new Set(),
    auctionTimeSeconds: 0,
    batchUnlockThreshold: 0,
    singleBatchChainIds: [],
    scheduleUnlockInterval: 0,
    registerInterval: 0,
    pollExplorerInterval: 0,
    registerAgainInterval: 0,
    closeLutsInterval: 0,
    disableUnlocker: true,
    feeParams,
    ...params,
  };
}

export function fakeToken(params?: Partial<Token>): Token {
  return {
    name: "",
    symbol: "",
    mint: Keypair.generate().publicKey.toString(),
    contract: "",
    chainId: 0,
    wChainId: 0,
    decimals: 0,
    logoURI: "",
    wrappedAddress: "",
    coingeckoId: "testid1",
    realOriginChainId: 0,
    realOriginContractAddress: "",
    supportsPermit: false,
    hasTransferFee: false,
    standard: "native",
    ...params,
  };
}

export function fakeExpenseParams(
  fromToken: Token,
  toToken: Token,
  params?: Partial<ExpenseParams>,
): ExpenseParams {
  return {
    isGasless: true,
    auctionMode: 0,
    exactCalculation: true,
    fromToken,
    fromChainId: 7,
    toToken,
    toChainId: 8,
    gasDrop: 0,
    ...params,
  };
}

export function fakeSwap(params?: Partial<Swap>): Swap {
  return {
    trader: "",
    sourceTxHash: "",
    orderHash: "",
    status: "",
    service: "",
    deadline: new Date(),
    sourceChain: 0,
    destChain: 0,
    destAddress: "",
    fromToken: fakeToken(),
    fromTokenAddress: "",
    fromTokenSymbol: "",
    fromAmount: new Decimal(0),
    fromAmount64: BigInt(0),
    toToken: fakeToken(),
    toTokenAddress: "",
    toTokenSymbol: "",
    toAmount: new Decimal(0),
    stateAddr: "",
    auctionStateAddr: "",
    initiatedAt: new Date(),
    swapRelayerFee: new Decimal(0),
    redeemRelayerFee: new Decimal(0),
    refundRelayerFee: new Decimal(0),
    auctionAddress: "",
    posAddress: "",
    mayanAddress: "",
    referrerAddress: "",
    unlockRecipient: "",
    minAmountOut: new Decimal(0),
    minAmountOut64: BigInt(0),
    gasDrop: new Decimal(0),
    gasDrop64: BigInt(0),
    randomKey: "",
    auctionMode: 0,
    mayanBps: 0,
    referrerBps: 0,
    driverAddress: "",
    gasless: false,
    gaslessTx: "",
    gaslessSignature: "",
    gaslessPermit: "",
    createTxHash: "",
    retries: 0,
    bidAmount: 0,
    ...params,
  };
}

export function fakeSwiftCosts(params?: Partial<SwiftCosts>): SwiftCosts {
  return {
    unlockSource: 0,
    fulfillCost: 0,
    fromTokenPrice: 0,
    fulfillAndUnlock: 0,
    ...params,
  };
}
