import { DriverService } from "../src/driver/driver";
import { Connection, Keypair } from "@solana/web3.js";
import { AuctionFulfillerConfig } from "../src/auction";
import { TokenList } from "../src/config/tokens";
import { WalletConfig } from "../src/config/wallet";
import { SimpleFulfillerConfig } from "../src/simple";
import { FeeService } from "../src/utils/fees";
import { SolanaMultiTxSender } from "../src/utils/solana-trx";
import { EvmFulfiller } from "../src/driver/evm";
import { SolanaFulfiller } from "../src/driver/solana";
import { NewSolanaIxHelper } from "../src/driver/solana-ix";
import { WalletsHelper } from "../src/driver/wallet-helper";
import { RpcConfig } from "../src/config/rpc";
import { ContractsConfig } from "../src/config/contracts";
import { CHAIN_ID_AVAX, CHAIN_ID_SOLANA } from "@certusone/wormhole-sdk";
import Decimal from "decimal.js";
import { fakeSwap, fakeSwiftCosts, fakeToken } from "./util/faker";
import { mock } from "ts-jest-mocker";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
//jest.mock("@solana/spl-token", () => {
//  const originalModule = jest.requireActual("@solana/spl-token");
//
//  return {
//    __esModule: true,
//    ...originalModule,
//    getAssociatedTokenAddressSync: jest.fn(() => "mocked baz"),
//  };
//});
jest.mock("@solana/spl-token");

describe("Driver service", () => {
  test("fulfill effectiveAmount less than 0 error", async () => {
    const simpleFulfillerCfg = mock(SimpleFulfillerConfig);
    const auctionFulfillerCfg = mock(AuctionFulfillerConfig);
    const solanaConnection = mock(Connection);
    const walletConfig = mock<WalletConfig>();
    const rpcConfig = mock<RpcConfig>();
    const contractsConfig = mock<ContractsConfig>();
    const solanaIxService = mock(NewSolanaIxHelper);
    const feeService = mock(FeeService);
    const solanaFulfiller = mock(SolanaFulfiller);
    const walletsHelper = mock(WalletsHelper);
    const evmFulFiller = mock(EvmFulfiller);
    const tokenList = mock(TokenList);
    const solanaSender = mock(SolanaMultiTxSender);

    contractsConfig.contracts[CHAIN_ID_SOLANA] = Keypair.generate().publicKey
      .toString();
    contractsConfig.auctionAddr = Keypair.generate().publicKey.toString();

    const driverService = new DriverService(
      simpleFulfillerCfg,
      auctionFulfillerCfg,
      solanaConnection,
      walletConfig,
      rpcConfig,
      contractsConfig,
      solanaIxService,
      feeService,
      solanaFulfiller,
      walletsHelper,
      evmFulFiller,
      tokenList,
      solanaSender,
    );

    const swap = fakeSwap({ fromAmount: new Decimal(10) });
    jest.spyOn(driverService, "getStateAddr").mockReturnValue(
      Keypair.generate().publicKey,
    );
    feeService.calculateSwiftExpensesAndUSDInFromToken.mockResolvedValue(
      fakeSwiftCosts({ fulfillAndUnlock: 310 }),
    );

    await expect(driverService.fulfill(swap)).rejects.toThrowError(
      "Shall not bid because effectiveAmountIn is less than 0",
    );
  });

  test("fulfill swap destination soloana", async () => {
    const simpleFulfillerCfg = mock(SimpleFulfillerConfig);
    const auctionFulfillerCfg = mock(AuctionFulfillerConfig);
    const solanaConnection = mock(Connection);
    const walletConfig = mock<WalletConfig>();
    const rpcConfig = mock<RpcConfig>();
    const contractsConfig = mock<ContractsConfig>();
    const solanaIxService = mock(NewSolanaIxHelper);
    const feeService = mock(FeeService);
    const solanaFulfiller = mock(SolanaFulfiller);
    const walletsHelper = mock(WalletsHelper);
    const evmFulFiller = mock(EvmFulfiller);
    const tokenList = mock(TokenList);
    const solanaSender = mock(SolanaMultiTxSender);

    contractsConfig.contracts[CHAIN_ID_SOLANA] = Keypair.generate().publicKey
      .toString();
    contractsConfig.auctionAddr = Keypair.generate().publicKey.toString();

    const driverService = new DriverService(
      simpleFulfillerCfg,
      auctionFulfillerCfg,
      solanaConnection,
      walletConfig,
      rpcConfig,
      contractsConfig,
      solanaIxService,
      feeService,
      solanaFulfiller,
      walletsHelper,
      evmFulFiller,
      tokenList,
      solanaSender,
    );

    const swap = fakeSwap({
      destChain: CHAIN_ID_SOLANA,
      sourceChain: 110,
      fromToken: fakeToken(),
      toToken: fakeToken(),
    });
    jest.spyOn(driverService, "getStateAddr").mockReturnValue(
      Keypair.generate().publicKey,
    );
    const expenses = fakeSwiftCosts();
    feeService.calculateSwiftExpensesAndUSDInFromToken.mockResolvedValue(
      expenses,
    );
    const driverToken = fakeToken();
    const driverTokenFunc = jest.spyOn(
      driverService,
      "getDriverSolanaTokenForBidAndSwap",
    ).mockReturnValue(driverToken);
    const fulfillAmount = 41;
    const fulfillAmountFunc = auctionFulfillerCfg.fulfillAmount
      .mockResolvedValue(fulfillAmount);
    const mockAssociatedTokenAddressSync =
      getAssociatedTokenAddressSync as jest.MockedFunction<
        typeof getAssociatedTokenAddressSync
      >;
    mockAssociatedTokenAddressSync.mockReturnValue(
      Keypair.generate().publicKey,
    );
    solanaFulfiller.getFulfillTransferTrxData
      .mockResolvedValue(
        {
          instructions: [],
          lookupTables: [],
          signers: [],
        },
      );
    solanaSender.createAndSendOptimizedTransaction
      .mockResolvedValue("hash");

    const ret = await driverService.fulfill(swap);

    expect(ret).toBe(void 0);
    expect(driverTokenFunc).toHaveBeenLastCalledWith(
      swap.sourceChain,
      swap.fromToken,
    );
    expect(fulfillAmountFunc).toHaveBeenLastCalledWith(
      driverToken,
      expect.anything(),
      swap,
      expenses,
    );
    expect(solanaFulfiller.getFulfillTransferTrxData).toHaveBeenCalledTimes(1);
    expect(solanaSender.createAndSendOptimizedTransaction)
      .toHaveBeenCalledTimes(1);

    const ret2 = await driverService.fulfill(swap);
    expect(ret2).not.toBe(void 0);
  });

  test("fulfill swap destination not soloana", async () => {
    const simpleFulfillerCfg = mock(SimpleFulfillerConfig);
    const auctionFulfillerCfg = mock(AuctionFulfillerConfig);
    const solanaConnection = mock(Connection);
    const walletConfig = mock<WalletConfig>();
    const rpcConfig = mock<RpcConfig>();
    const contractsConfig = mock<ContractsConfig>();
    const solanaIxService = mock(NewSolanaIxHelper);
    const feeService = mock(FeeService);
    const solanaFulfiller = mock(SolanaFulfiller);
    const walletsHelper = mock(WalletsHelper);
    const evmFulFiller = mock(EvmFulfiller);
    const tokenList = mock(TokenList);
    const solanaSender = mock(SolanaMultiTxSender);

    contractsConfig.contracts[CHAIN_ID_SOLANA] = Keypair.generate().publicKey
      .toString();
    contractsConfig.auctionAddr = Keypair.generate().publicKey.toString();

    const driverService = new DriverService(
      simpleFulfillerCfg,
      auctionFulfillerCfg,
      solanaConnection,
      walletConfig,
      rpcConfig,
      contractsConfig,
      solanaIxService,
      feeService,
      solanaFulfiller,
      walletsHelper,
      evmFulFiller,
      tokenList,
      solanaSender,
    );

    const swap = fakeSwap({
      destChain: CHAIN_ID_AVAX,
      sourceChain: 110,
      fromToken: fakeToken(),
      toToken: fakeToken(),
    });
    jest.spyOn(driverService, "getStateAddr").mockReturnValue(
      Keypair.generate().publicKey,
    );
    const expenses = fakeSwiftCosts();
    feeService.calculateSwiftExpensesAndUSDInFromToken.mockResolvedValue(
      expenses,
    );
    const driverToken = fakeToken();
    const driverTokenFunc = jest.spyOn(
      driverService,
      "getDriverEvmTokenForBidAndSwap",
    ).mockReturnValue(driverToken);
    const fulfillAmount = 41;
    const fulfillAmountFunc = auctionFulfillerCfg.fulfillAmount
      .mockResolvedValue(fulfillAmount);
    evmFulFiller.fulfillAuction.mockResolvedValue();
    solanaSender.createAndSendOptimizedTransaction
      .mockResolvedValue("hash");

    await driverService.fulfill(swap);

    expect(driverTokenFunc).toHaveBeenLastCalledWith(
      swap.sourceChain,
      swap.destChain,
      swap.fromToken,
    );
    expect(fulfillAmountFunc).toHaveBeenLastCalledWith(
      driverToken,
      expect.anything(),
      swap,
      expenses,
    );
    expect(evmFulFiller.fulfillAuction).toHaveBeenCalledTimes(1);
  });
});
