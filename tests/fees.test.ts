import { mock } from "ts-jest-mocker";
import { FeeService } from "../src/utils/fees";
import { TokenList } from "../src/config/tokens";
import { CHAIN_ID_ETH, CHAIN_ID_SOLANA } from "../src/config/chains";
jest.mock("axios");
import axios from "axios";
import { EvmProviders } from "../src/utils/evm-providers";
import { FeeData, JsonRpcProvider } from "ethers6";
import { AUCTION_MODES } from "../src/utils/state-parser";
import { CHAIN_ID_COSMOSHUB, CHAIN_ID_SEI } from "@certusone/wormhole-sdk";
import {
  fakeEndPoints,
  fakeExpenseParams,
  fakeGlobalConfig,
  fakeSwiftFeeParams,
  fakeToken,
} from "./util/faker";

describe("FeeService", () => {
  const overallMultiplier = 1.05;
  test("calculateSwiftExpensesAndUSDInFromToken postAuctionCost based on auctionMode", async () => {
    const endPoints = fakeEndPoints();
    const swiftParams = fakeSwiftFeeParams();
    swiftParams.postAuctionCost = 50;
    const globalCfg = fakeGlobalConfig(swiftParams);
    const token = fakeToken();
    const expenseParams = fakeExpenseParams(token, token);

    const mockedTokenList = mock(TokenList);
    mockedTokenList.nativeTokens = {
      [expenseParams.fromChainId]: token,
      [expenseParams.toChainId]: token,
      [CHAIN_ID_SOLANA]: token,
    };

    const mockedJsonRpcProvider = mock(JsonRpcProvider);
    const feeData = new FeeData(BigInt(700));
    mockedJsonRpcProvider.getFeeData.mockResolvedValue(
      Promise.resolve(feeData),
    );
    const evmProviders: EvmProviders = {
      [expenseParams.fromChainId]: mockedJsonRpcProvider,
      [expenseParams.toChainId]: mockedJsonRpcProvider,
    };

    const feeService = new FeeService(
      evmProviders,
      endPoints,
      mockedTokenList,
      globalCfg,
    );

    const mockedAxios = axios as jest.Mocked<typeof axios>;
    mockedAxios.get.mockResolvedValue({
      data: {
        [mockedTokenList.nativeTokens[CHAIN_ID_SOLANA].coingeckoId]: 1000,
      },
    });

    const calculateSolanaFee = jest.spyOn(feeService, "calculateSolanaFee")
      .mockImplementation(() => Promise.resolve(0));

    expenseParams.auctionMode = AUCTION_MODES.ENGLISH;
    await feeService
      .calculateSwiftExpensesAndUSDInFromToken(expenseParams);

    expect(calculateSolanaFee).toHaveBeenLastCalledWith(
      swiftParams.postAuctionCost,
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );

    expenseParams.auctionMode = AUCTION_MODES.UNKOWNN;
    await feeService
      .calculateSwiftExpensesAndUSDInFromToken(expenseParams);

    expect(calculateSolanaFee).toHaveBeenLastCalledWith(
      0,
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  test("calculateSwiftExpensesAndUSDInFromToken fulfillGas", async () => {
    const endPoints = fakeEndPoints();
    const swiftParams = fakeSwiftFeeParams({
      baseFulfillGasWithBatchEth: 33,
      baseFulfillGasWithOutBatchEth: 91,
      swapFulfillAddedGas: 10,
      erc20GasOverHead: 2,
      auctionVaaVerificationAddedGas: 7,
    });
    const globalCfg = fakeGlobalConfig(swiftParams);
    const fromToken = fakeToken();
    const toToken = fakeToken();
    const expenseParams = fakeExpenseParams(fromToken, toToken);

    const mockedTokenList = mock(TokenList);
    const token = fakeToken();
    mockedTokenList.nativeTokens = {
      [expenseParams.fromChainId]: token,
      [expenseParams.toChainId]: token,
      [CHAIN_ID_SOLANA]: token,
      [CHAIN_ID_ETH]: token,
    };

    const mockedJsonRpcProvider = mock(JsonRpcProvider);
    const feeData = new FeeData(BigInt(700));
    mockedJsonRpcProvider.getFeeData.mockResolvedValue(
      Promise.resolve(feeData),
    );
    const evmProviders: EvmProviders = {
      [expenseParams.fromChainId]: mockedJsonRpcProvider,
      [expenseParams.toChainId]: mockedJsonRpcProvider,
      [CHAIN_ID_SOLANA]: mockedJsonRpcProvider,
      [CHAIN_ID_ETH]: mockedJsonRpcProvider,
    };

    const feeService = new FeeService(
      evmProviders,
      endPoints,
      mockedTokenList,
      globalCfg,
    );

    const mockedAxios = axios as jest.Mocked<typeof axios>;
    mockedAxios.get.mockResolvedValue({
      data: {
        [mockedTokenList.nativeTokens[CHAIN_ID_SOLANA].coingeckoId]: 1000,
      },
    });

    const calculateGenericEvmFee = jest.spyOn(
      feeService,
      "calculateGenericEvmFee",
    )
      .mockImplementation(() => Promise.resolve(0));

    mockedTokenList.getEth.mockReturnValue(fakeToken());
    let sourceEth = mockedTokenList.getEth(expenseParams.fromChainId);
    let sourceSolEth = expenseParams.fromChainId === CHAIN_ID_SOLANA
      ? mockedTokenList.getWethSol()
      : null;
    expect(
      expenseParams.fromToken.contract !== sourceEth?.contract &&
        expenseParams.fromToken.contract !== sourceSolEth?.contract,
    ).toBeFalsy();

    await feeService
      .calculateSwiftExpensesAndUSDInFromToken(expenseParams);

    expect(calculateGenericEvmFee).toHaveBeenNthCalledWith(
      1,
      swiftParams.baseFulfillGasWithBatchEth,
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );

    mockedTokenList.getEth.mockReturnValue(fakeToken({ contract: "abc1" }));
    sourceEth = mockedTokenList.getEth(expenseParams.fromChainId);
    sourceSolEth = expenseParams.fromChainId === CHAIN_ID_SOLANA
      ? mockedTokenList.getWethSol()
      : null;
    expect(
      expenseParams.fromToken.contract !== sourceEth?.contract &&
        expenseParams.fromToken.contract !== sourceSolEth?.contract,
    ).toBeTruthy();
    expenseParams.fromChainId = CHAIN_ID_SOLANA;

    calculateGenericEvmFee.mockReset();
    await feeService
      .calculateSwiftExpensesAndUSDInFromToken(expenseParams);

    expect(calculateGenericEvmFee).toHaveBeenNthCalledWith(
      1,
      swiftParams.baseFulfillGasWithBatchEth +
        swiftParams.swapFulfillAddedGas +
        swiftParams.erc20GasOverHead,
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );

    mockedTokenList.getNativeUsdc.mockReturnValue(
      fakeToken({ contract: expenseParams.fromToken.contract }),
    );
    const sourceUsdc = mockedTokenList.getNativeUsdc(expenseParams.fromChainId);
    const destUsdc = mockedTokenList.getNativeUsdc(expenseParams.toChainId);
    expect(
      sourceUsdc?.contract === expenseParams.fromToken.contract &&
        destUsdc?.contract === expenseParams.toToken.contract,
    ).toBeTruthy();

    calculateGenericEvmFee.mockReset();
    await feeService
      .calculateSwiftExpensesAndUSDInFromToken(expenseParams);

    expect(calculateGenericEvmFee).toHaveBeenNthCalledWith(
      1,
      swiftParams.baseFulfillGasWithBatchEth +
        swiftParams.erc20GasOverHead,
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );

    expenseParams.auctionMode = AUCTION_MODES.ENGLISH;
    expenseParams.toChainId = CHAIN_ID_ETH;

    calculateGenericEvmFee.mockReset();
    await feeService
      .calculateSwiftExpensesAndUSDInFromToken(expenseParams);

    expect(calculateGenericEvmFee).toHaveBeenNthCalledWith(
      1,
      swiftParams.baseFulfillGasWithOutBatchEth +
        swiftParams.auctionVaaVerificationAddedGas +
        swiftParams.erc20GasOverHead,
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  test("calculateSwiftExpensesAndUSDInFromToken fulfillCost to solana", async () => {
    const endPoints = fakeEndPoints();
    const swiftParams = fakeSwiftFeeParams({
      solTxCost: 11,
      additionalSolfulfillCost: 12,
      shrinkedStateCost: 13,
      ataCreationCost: 14,
    });
    const globalCfg = fakeGlobalConfig(swiftParams);
    const fromToken = fakeToken({ coingeckoId: "from" });
    const toToken = fakeToken({ coingeckoId: "to" });
    const expenseParams = fakeExpenseParams(fromToken, toToken, {
      toChainId: CHAIN_ID_SOLANA,
    });

    const mockedTokenList = mock(TokenList);
    mockedTokenList.nativeTokens = {
      [expenseParams.fromChainId]: fakeToken({ coingeckoId: "token2" }),
      [expenseParams.toChainId]: fakeToken({ coingeckoId: "token3" }),
    };

    const mockedJsonRpcProvider = mock(JsonRpcProvider);
    const feeData = new FeeData(BigInt(700));
    mockedJsonRpcProvider.getFeeData.mockResolvedValue(
      Promise.resolve(feeData),
    );
    const evmProviders: EvmProviders = {
      [expenseParams.fromChainId]: mockedJsonRpcProvider,
      [expenseParams.toChainId]: mockedJsonRpcProvider,
    };

    const feeService = new FeeService(
      evmProviders,
      endPoints,
      mockedTokenList,
      globalCfg,
    );

    const solPrice = 1000;
    const fromTokenPrice = 250;
    const nativeFromPrice = 3;
    const mockedAxios = axios as jest.Mocked<typeof axios>;
    mockedAxios.get.mockResolvedValue({
      data: {
        [mockedTokenList.nativeTokens[CHAIN_ID_SOLANA].coingeckoId]: solPrice,
        [expenseParams.fromToken.coingeckoId]: fromTokenPrice,
        [mockedTokenList.nativeTokens[expenseParams.fromChainId].coingeckoId]:
          nativeFromPrice,
      },
    });

    const solanaFeeRet = 21;
    const calculateSolanaFee = jest.spyOn(feeService, "calculateSolanaFee")
      .mockImplementation(() => Promise.resolve(solanaFeeRet));
    const genericEvmFeeRet = 11;
    const calculateGenericEvmFee = jest.spyOn(
      feeService,
      "calculateGenericEvmFee",
    )
      .mockImplementation(() => Promise.resolve(genericEvmFeeRet));

    const swiftCosts = await feeService
      .calculateSwiftExpensesAndUSDInFromToken(expenseParams);

    expect(swiftCosts.fulfillCost).toBe(solanaFeeRet);
    expect(calculateSolanaFee).toHaveBeenNthCalledWith(
      1,
      swiftParams.solTxCost + swiftParams.additionalSolfulfillCost +
        swiftParams.shrinkedStateCost + swiftParams.ataCreationCost,
      solPrice,
      fromTokenPrice,
      expenseParams.gasDrop,
      overallMultiplier,
    );
    expect(calculateGenericEvmFee).not.toHaveBeenCalled();
  });

  test("calculateSwiftExpensesAndUSDInFromToken fulfillCost to other than solana", async () => {
    const endPoints = fakeEndPoints();
    const swiftParams = fakeSwiftFeeParams();
    const globalCfg = fakeGlobalConfig(swiftParams);
    const fromToken = fakeToken({ coingeckoId: "from" });
    const toToken = fakeToken({ coingeckoId: "to" });
    const expenseParams = fakeExpenseParams(fromToken, toToken);

    const token = fakeToken({ coingeckoId: "token1" });
    const mockedTokenList = mock(TokenList);
    mockedTokenList.nativeTokens = {
      [expenseParams.fromChainId]: fakeToken({ coingeckoId: "token2" }),
      [expenseParams.toChainId]: fakeToken({ coingeckoId: "token3" }),
      [CHAIN_ID_SOLANA]: token,
    };

    const mockedJsonRpcProvider = mock(JsonRpcProvider);
    const feeData = new FeeData(BigInt(700));
    mockedJsonRpcProvider.getFeeData.mockResolvedValue(
      Promise.resolve(feeData),
    );
    const evmProviders: EvmProviders = {
      [expenseParams.fromChainId]: mockedJsonRpcProvider,
      [expenseParams.toChainId]: mockedJsonRpcProvider,
    };

    const feeService = new FeeService(
      evmProviders,
      endPoints,
      mockedTokenList,
      globalCfg,
    );

    const solPrice = 1000;
    const fromTokenPrice = 250;
    const nativeFromPrice = 3;
    const nativeToPrice = 70;
    const mockedAxios = axios as jest.Mocked<typeof axios>;
    mockedAxios.get.mockResolvedValue({
      data: {
        [mockedTokenList.nativeTokens[CHAIN_ID_SOLANA].coingeckoId]: solPrice,
        [expenseParams.fromToken.coingeckoId]: fromTokenPrice,
        [mockedTokenList.nativeTokens[expenseParams.fromChainId].coingeckoId]:
          nativeFromPrice,
        [mockedTokenList.nativeTokens[expenseParams.toChainId].coingeckoId]:
          nativeToPrice,
      },
    });

    const solanaFeeRet = 21;
    const calculateSolanaFee = jest.spyOn(feeService, "calculateSolanaFee")
      .mockImplementation(() => Promise.resolve(solanaFeeRet));
    const genericEvmFeeRet = 11;
    const calculateGenericEvmFee = jest.spyOn(
      feeService,
      "calculateGenericEvmFee",
    )
      .mockImplementation(() => Promise.resolve(genericEvmFeeRet));

    const swiftCosts = await feeService
      .calculateSwiftExpensesAndUSDInFromToken(expenseParams);

    expect(swiftCosts.fulfillCost).toBe(solanaFeeRet + genericEvmFeeRet);
    expect(calculateSolanaFee).toHaveBeenNthCalledWith(
      1,
      0,
      solPrice,
      fromTokenPrice,
      0,
      overallMultiplier,
    );
    expect(calculateGenericEvmFee).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.anything(),
      nativeToPrice,
      fromTokenPrice,
      expenseParams.gasDrop,
      overallMultiplier,
    );
  });

  test("calculateSwiftExpensesAndUSDInFromToken unlockFee cost from solana", async () => {
    const endPoints = fakeEndPoints();
    const swiftParams = fakeSwiftFeeParams({
      solTxCost: 11,
      additionalSolfulfillCost: 12,
      shrinkedStateCost: 13,
      ataCreationCost: 14,
      postUnlockVaaSingle: 6,
      postUnlockVaaBase: 6,
      postUnlockVaaPerItem: 13,
    });
    const globalCfg = fakeGlobalConfig(swiftParams);
    const fromToken = fakeToken({ coingeckoId: "from" });
    const toToken = fakeToken({ coingeckoId: "to" });
    const expenseParams = fakeExpenseParams(fromToken, toToken, {
      fromChainId: CHAIN_ID_SOLANA,
      toChainId: CHAIN_ID_ETH,
    });

    const mockedTokenList = mock(TokenList);
    mockedTokenList.nativeTokens = {
      [expenseParams.fromChainId]: fakeToken({ coingeckoId: "token2" }),
      [expenseParams.toChainId]: fakeToken({ coingeckoId: "token3" }),
      [toToken.chainId]: toToken,
    };

    const mockedJsonRpcProvider = mock(JsonRpcProvider);
    const feeData = new FeeData(BigInt(700));
    mockedJsonRpcProvider.getFeeData.mockResolvedValue(
      Promise.resolve(feeData),
    );
    const evmProviders: EvmProviders = {
      [expenseParams.fromChainId]: mockedJsonRpcProvider,
      [expenseParams.toChainId]: mockedJsonRpcProvider,
      [toToken.chainId]: mockedJsonRpcProvider,
    };

    const feeService = new FeeService(
      evmProviders,
      endPoints,
      mockedTokenList,
      globalCfg,
    );

    const solPrice = 1000;
    const fromTokenPrice = 250;
    const nativeToPrice = 70;
    const mockedAxios = axios as jest.Mocked<typeof axios>;
    mockedAxios.get.mockResolvedValue({
      data: {
        [mockedTokenList.nativeTokens[expenseParams.fromChainId].coingeckoId]:
          solPrice,
        [expenseParams.fromToken.coingeckoId]: fromTokenPrice,
        [mockedTokenList.nativeTokens[toToken.chainId].coingeckoId]:
          nativeToPrice,
      },
    });

    const unlockFeeRet = 21;
    const batchPostCostRet = 41;
    const calculateSolanaFee = jest.spyOn(feeService, "calculateSolanaFee")
      .mockImplementation(() => Promise.resolve(unlockFeeRet));
    const calculateGenericEvmFee = jest.spyOn(
      feeService,
      "calculateGenericEvmFee",
    )
      .mockImplementation(() => Promise.resolve(batchPostCostRet));

    let swiftCosts = await feeService
      .calculateSwiftExpensesAndUSDInFromToken(expenseParams);

    expect(swiftCosts.unlockSource).toBe(unlockFeeRet);
    expect(calculateSolanaFee).toHaveBeenLastCalledWith(
      swiftParams.solTxCost + swiftParams.postUnlockVaaSingle,
      solPrice,
      fromTokenPrice,
      0,
      overallMultiplier,
    );
    expect(calculateGenericEvmFee).toHaveBeenCalledTimes(1);

    expenseParams.toChainId = toToken.chainId;
    swiftCosts = await feeService
      .calculateSwiftExpensesAndUSDInFromToken(expenseParams);

    expect(swiftCosts.unlockSource).toBe((unlockFeeRet + batchPostCostRet) / 6);
    expect(calculateSolanaFee).toHaveBeenLastCalledWith(
      swiftParams.postUnlockVaaBase + swiftParams.postUnlockVaaPerItem * 8 +
        swiftParams.solTxCost - swiftParams.ataCreationCost,
      solPrice,
      fromTokenPrice,
      0,
      overallMultiplier,
    );
    expect(calculateGenericEvmFee).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      nativeToPrice,
      fromTokenPrice,
      0,
      overallMultiplier,
    );
  });

  test("calculateSwiftExpensesAndUSDInFromToken unlockFee cost from other", async () => {
    const endPoints = fakeEndPoints();
    const swiftParams = fakeSwiftFeeParams({
      solTxCost: 11,
      additionalSolfulfillCost: 12,
      shrinkedStateCost: 13,
      ataCreationCost: 14,
      postUnlockVaaSingle: 6,
      postUnlockVaaBase: 6,
      postUnlockVaaPerItem: 13,
    });
    const globalCfg = fakeGlobalConfig(swiftParams);
    const fromToken = fakeToken({ coingeckoId: "from" });
    const toToken = fakeToken({ coingeckoId: "to" });
    const expenseParams = fakeExpenseParams(fromToken, toToken, {
      fromChainId: CHAIN_ID_SEI,
      toChainId: CHAIN_ID_ETH,
    });

    const mockedTokenList = mock(TokenList);
    mockedTokenList.nativeTokens = {
      [expenseParams.fromChainId]: fakeToken({ coingeckoId: "token2" }),
      [expenseParams.toChainId]: fakeToken({ coingeckoId: "token3" }),
      [toToken.chainId]: toToken,
      [CHAIN_ID_SOLANA]: fakeToken(),
      [CHAIN_ID_COSMOSHUB]: fakeToken({ coingeckoId: "cosmos" }),
    };

    const mockedJsonRpcProvider = mock(JsonRpcProvider);
    const feeData = new FeeData(BigInt(700));
    mockedJsonRpcProvider.getFeeData.mockResolvedValue(
      Promise.resolve(feeData),
    );
    const evmProviders: EvmProviders = {
      [expenseParams.fromChainId]: mockedJsonRpcProvider,
      [expenseParams.toChainId]: mockedJsonRpcProvider,
      [toToken.chainId]: mockedJsonRpcProvider,
      [CHAIN_ID_COSMOSHUB]: mockedJsonRpcProvider,
    };

    const feeService = new FeeService(
      evmProviders,
      endPoints,
      mockedTokenList,
      globalCfg,
    );

    const solPrice = 1000;
    const fromChainIdPrice = 780;
    const fromTokenPrice = 250;
    const nativeToPrice = 70;
    const cosmosPrice = 230;
    const mockedAxios = axios as jest.Mocked<typeof axios>;
    mockedAxios.get.mockResolvedValue({
      data: {
        [mockedTokenList.nativeTokens[expenseParams.fromChainId].coingeckoId]:
          fromChainIdPrice,
        [expenseParams.fromToken.coingeckoId]: fromTokenPrice,
        [mockedTokenList.nativeTokens[toToken.chainId].coingeckoId]:
          nativeToPrice,
        [mockedTokenList.nativeTokens[CHAIN_ID_SOLANA].coingeckoId]: solPrice,
        [mockedTokenList.nativeTokens[CHAIN_ID_COSMOSHUB].coingeckoId]:
          cosmosPrice,
      },
    });

    const solanaFeeFeeRet = 21;
    const batchPostCostRet = 41;
    const unlockRefundRet = 17;
    const calculateSolanaFee = jest.spyOn(feeService, "calculateSolanaFee")
      .mockImplementation(() => Promise.resolve(solanaFeeFeeRet));
    const calculateGenericEvmFee = jest.spyOn(
      feeService,
      "calculateGenericEvmFee",
    )
      .mockImplementation(() => Promise.resolve(batchPostCostRet));
    const calculateUnlockAndRefundOnEvmFee = jest.spyOn(
      feeService,
      "calculateUnlockAndRefundOnEvmFee",
    )
      .mockImplementation(() => Promise.resolve({ unlock: unlockRefundRet }));

    let swiftCosts = await feeService
      .calculateSwiftExpensesAndUSDInFromToken(expenseParams);

    expect(swiftCosts.unlockSource).toBe(unlockRefundRet);
    expect(calculateUnlockAndRefundOnEvmFee).toHaveBeenLastCalledWith(
      expect.anything(),
      expenseParams.fromToken.contract,
      expenseParams.fromChainId,
      fromChainIdPrice,
      mockedTokenList.nativeTokens[expenseParams.fromChainId].contract,
      fromTokenPrice,
      1,
      overallMultiplier,
    );

    expenseParams.toChainId = CHAIN_ID_SOLANA;
    swiftCosts = await feeService
      .calculateSwiftExpensesAndUSDInFromToken(expenseParams);

    expect(swiftCosts.unlockSource).toBe(unlockRefundRet + solanaFeeFeeRet / 6);
    expect(calculateSolanaFee).toHaveBeenLastCalledWith(
      expect.anything(),
      solPrice,
      fromTokenPrice,
      0,
      overallMultiplier,
    );
    expect(calculateUnlockAndRefundOnEvmFee).toHaveBeenLastCalledWith(
      expect.anything(),
      expenseParams.fromToken.contract,
      expenseParams.fromChainId,
      fromChainIdPrice,
      mockedTokenList.nativeTokens[expenseParams.fromChainId].contract,
      fromTokenPrice,
      6,
      overallMultiplier,
    );

    expenseParams.toChainId = CHAIN_ID_COSMOSHUB;
    swiftCosts = await feeService
      .calculateSwiftExpensesAndUSDInFromToken(expenseParams);

    expect(swiftCosts.unlockSource).toBe(
      unlockRefundRet + batchPostCostRet / 6,
    );
    expect(calculateGenericEvmFee).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      cosmosPrice,
      fromTokenPrice,
      0,
      overallMultiplier,
    );
    expect(calculateUnlockAndRefundOnEvmFee).toHaveBeenLastCalledWith(
      expect.anything(),
      expenseParams.fromToken.contract,
      expenseParams.fromChainId,
      fromChainIdPrice,
      mockedTokenList.nativeTokens[expenseParams.fromChainId].contract,
      fromTokenPrice,
      6,
      overallMultiplier,
    );
  });

  test("calculateSolanaFee", async () => {
    const endPoints = fakeEndPoints();
    const swiftParams = fakeSwiftFeeParams();
    swiftParams.postAuctionCost = 50;
    const globalCfg = fakeGlobalConfig(swiftParams);
    const token = fakeToken();
    const expenseParams = fakeExpenseParams(token, token);

    const mockedTokenList = mock(TokenList);
    mockedTokenList.nativeTokens = {
      [expenseParams.fromChainId]: token,
      [expenseParams.toChainId]: token,
      [CHAIN_ID_SOLANA]: token,
    };

    const mockedJsonRpcProvider = mock(JsonRpcProvider);
    const feeData = new FeeData(BigInt(700));
    mockedJsonRpcProvider.getFeeData.mockResolvedValue(
      Promise.resolve(feeData),
    );
    const evmProviders: EvmProviders = {
      [expenseParams.fromChainId]: mockedJsonRpcProvider,
      [expenseParams.toChainId]: mockedJsonRpcProvider,
    };

    const feeService = new FeeService(
      evmProviders,
      endPoints,
      mockedTokenList,
      globalCfg,
    );

    type FeeTest = {
      feeInSol: number;
      soPrice: number;
      fromTokenPrice: number;
      gasDrop: number;
      multiplier: number;
      expected: number;
    };
    const tests: [FeeTest] = [
      {
        feeInSol: 10,
        soPrice: 20,
        fromTokenPrice: 30,
        gasDrop: 40,
        multiplier: 1.10,
        expected: 36.66666667,
      },
    ];

    for (let t of tests) {
      let fee = await feeService.calculateSolanaFee(
        t.feeInSol,
        t.soPrice,
        t.fromTokenPrice,
        t.gasDrop,
        t.multiplier,
      );
      expect(fee).toBe(t.expected);
    }
  });

  test("calculateGenericEvmFee", async () => {
    const endPoints = fakeEndPoints();
    const swiftParams = fakeSwiftFeeParams();
    swiftParams.postAuctionCost = 50;
    const globalCfg = fakeGlobalConfig(swiftParams);
    const token = fakeToken();
    const expenseParams = fakeExpenseParams(token, token);

    const mockedTokenList = mock(TokenList);
    mockedTokenList.nativeTokens = {
      [expenseParams.fromChainId]: token,
      [expenseParams.toChainId]: token,
      [CHAIN_ID_SOLANA]: token,
    };

    const mockedJsonRpcProvider = mock(JsonRpcProvider);
    const feeData = new FeeData(BigInt(700));
    mockedJsonRpcProvider.getFeeData.mockResolvedValue(
      Promise.resolve(feeData),
    );
    const evmProviders: EvmProviders = {
      [expenseParams.fromChainId]: mockedJsonRpcProvider,
      [expenseParams.toChainId]: mockedJsonRpcProvider,
    };

    const feeService = new FeeService(
      evmProviders,
      endPoints,
      mockedTokenList,
      globalCfg,
    );

    type FeeTest = {
      gas: number;
      gasPrice: BigInt;
      nativeTokenPrice: number;
      referenceTokenPrice: number;
      gasDrop: number;
      factor: number;
      expected: number;
    };
    const tests: [FeeTest] = [
      {
        gas: 10,
        gasPrice: BigInt(20),
        nativeTokenPrice: 30,
        referenceTokenPrice: 40,
        gasDrop: 12,
        factor: 1.10,
        expected: 9.90000001,
      },
    ];

    for (let t of tests) {
      let fee = await feeService.calculateGenericEvmFee(
        t.gas,
        t.gasPrice,
        t.nativeTokenPrice,
        t.referenceTokenPrice,
        t.gasDrop,
        t.factor,
      );
      expect(fee).toBe(t.expected);
    }
  });
});
