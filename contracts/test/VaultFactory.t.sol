// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test, Vm} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {StockVault} from "../src/StockVault.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {IAggregatorV3} from "../src/interfaces/IUniswapV3.sol";

/// @dev Fork of Robinhood Chain (4663) at head, same as the other suites (FORK_URL and FORK_BLOCK apply). Three
/// eligible Stock Tokens go through the factory against their real pools and real Chainlink proxies, nothing mocked:
/// NVDA has the Stock Token as token1, SPCX and GOOGL as token0, so both orderings are covered. Each vault takes a
/// real deposit through the oracle gate.
contract VaultFactoryTest is Test {
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant NPM = 0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3;
    address constant ROUTER = 0xCaf681a66D020601342297493863E78C959E5cb2;

    address constant NVDA = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC;
    address constant NVDA_POOL = 0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3;
    address constant NVDA_FEED = 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15;
    address constant SPCX = 0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa;
    address constant SPCX_POOL = 0xc61284332117c3FB23A2A56cceFFD07F7aF60029;
    address constant SPCX_FEED = 0xB265810950ba6c5C0Ff821c9963014a56fD8Bffb;
    address constant GOOGL = 0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3;
    address constant GOOGL_POOL = 0x34D0dC122CF9A8Eb296fC5e0D3A233625D7d19b7;
    address constant GOOGL_FEED = 0xF6f373a037c30F0e5010d854385cA89185AE638b;

    VaultFactory factory;
    bytes code;
    address factoryOwner = makeAddr("factoryOwner");
    address vaultOwner = makeAddr("vaultOwner");
    address keeper = makeAddr("keeper");
    address treasury = makeAddr("treasury");
    address alice = makeAddr("alice");
    address stranger = makeAddr("stranger");

    function setUp() public {
        uint256 blk = vm.envOr("FORK_BLOCK", uint256(0));
        string memory url = vm.envOr("FORK_URL", string("robinhood"));
        if (blk == 0) vm.createSelectFork(url);
        else vm.createSelectFork(url, blk);
        code = vm.getCode("StockVault.sol:StockVault");
        factory = new VaultFactory(factoryOwner, keccak256(code), _defaults(keeper));
    }

    function _params() internal pure returns (StockVault.Params memory) {
        return StockVault.Params({
            rangeBps: 500,
            perfFeeBps: 1000,
            maxDeviationBps: 100,
            slippageBps: 100,
            exitBufferBps: 30,
            maxStaleness: 90_000,
            twapWindow: 600,
            minRebalanceInterval: 6 hours
        });
    }

    function _defaults(address k) internal view returns (VaultFactory.Defaults memory) {
        return VaultFactory.Defaults({
            usdg: USDG,
            positionManager: NPM,
            router: ROUTER,
            vaultOwner: vaultOwner,
            keeper: k,
            treasury: treasury,
            params: _params()
        });
    }

    function _create(address stock, address pool, address feed) internal returns (StockVault v) {
        vm.prank(factoryOwner);
        v = StockVault(factory.createVault(code, stock, pool, feed, 0));
    }

    function _createThree() internal returns (StockVault nvda, StockVault spcx, StockVault googl) {
        nvda = _create(NVDA, NVDA_POOL, NVDA_FEED);
        spcx = _create(SPCX, SPCX_POOL, SPCX_FEED);
        googl = _create(GOOGL, GOOGL_POOL, GOOGL_FEED);
    }

    // ---------------------------------------------------------------- deploy

    function test_createsThreeVaultsAndRegistersThem() public {
        vm.recordLogs();
        (StockVault nvda, StockVault spcx, StockVault googl) = _createThree();

        assertEq(factory.vaultCount(), 3);
        assertEq(factory.vaultOf(NVDA, NVDA_POOL), address(nvda));
        assertEq(factory.vaultOf(SPCX, SPCX_POOL), address(spcx));
        assertEq(factory.vaultOf(GOOGL, GOOGL_POOL), address(googl));
        assertTrue(factory.isVault(address(nvda)) && factory.isVault(address(spcx)) && factory.isVault(address(googl)));
        assertFalse(factory.isVault(stranger));
        assertNotEq(address(nvda), address(spcx));

        // VaultCreated: indexed stock, pool, vault; data feed, fee tier, index
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 seen;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(factory) || logs[i].topics[0] != VaultFactory.VaultCreated.selector) continue;
            (address feed, uint24 tier, uint256 index) = abi.decode(logs[i].data, (address, uint24, uint256));
            assertEq(index, seen);
            if (seen == 0) {
                assertEq(address(uint160(uint256(logs[i].topics[1]))), NVDA);
                assertEq(address(uint160(uint256(logs[i].topics[2]))), NVDA_POOL);
                assertEq(address(uint160(uint256(logs[i].topics[3]))), address(nvda));
                assertEq(feed, NVDA_FEED);
                assertEq(tier, 500);
            }
            ++seen;
        }
        assertEq(seen, 3, "one VaultCreated per vault");

        VaultFactory.Entry memory e = factory.entryAt(1);
        assertEq(e.stock, SPCX);
        assertEq(e.pool, SPCX_POOL);
        assertEq(e.feed, SPCX_FEED);
        assertEq(e.vault, address(spcx));
        assertEq(e.feeTier, 500);

        address[] memory ofNvda = factory.vaultsOfStock(NVDA);
        assertEq(ofNvda.length, 1);
        assertEq(ofNvda[0], address(nvda));
    }

    function test_vaultsAreConfiguredFromTheFactoryDefaults() public {
        (StockVault nvda, StockVault spcx, StockVault googl) = _createThree();
        StockVault[3] memory vs = [nvda, spcx, googl];
        address[3] memory stocks = [NVDA, SPCX, GOOGL];
        address[3] memory pools = [NVDA_POOL, SPCX_POOL, GOOGL_POOL];
        address[3] memory feeds = [NVDA_FEED, SPCX_FEED, GOOGL_FEED];
        string[3] memory syms = ["svNVDA", "svSPCX", "svGOOGL"];
        for (uint256 i; i < 3; ++i) {
            StockVault v = vs[i];
            assertEq(v.asset(), stocks[i]);
            assertEq(address(v.usdg()), USDG);
            assertEq(address(v.pool()), pools[i]);
            assertEq(address(v.feed()), feeds[i]);
            assertEq(address(v.positionManager()), NPM);
            assertEq(address(v.router()), ROUTER);
            assertEq(v.owner(), vaultOwner, "vault owner is the multisig, not the factory");
            assertEq(v.keeper(), keeper);
            assertEq(v.treasury(), treasury);
            assertEq(v.depositCap(), 0);
            assertEq(v.symbol(), syms[i]);
            (uint16 range, uint16 perf,,,,,, uint32 minInterval) = v.params();
            assertEq(range, 500);
            assertEq(perf, 1000);
            assertEq(minInterval, 6 hours);
        }
        assertTrue(nvda.stockIsToken0() == false && spcx.stockIsToken0() == true && googl.stockIsToken0() == true);
        assertEq(nvda.name(), "Stock Vault NVDA");
    }

    function test_oneDepositPerVaultThroughTheOracleGate() public {
        (StockVault nvda, StockVault spcx, StockVault googl) = _createThree();
        StockVault[3] memory vs = [nvda, spcx, googl];
        address[3] memory stocks = [NVDA, SPCX, GOOGL];
        for (uint256 i; i < 3; ++i) {
            StockVault v = vs[i];
            (StockVault.Status st,,,,,) = v.health();
            assertEq(uint256(st), uint256(StockVault.Status.Ok), "real feed, TWAP and spot agree");
            deal(stocks[i], alice, 10e18);
            vm.startPrank(alice);
            IERC20(stocks[i]).approve(address(v), type(uint256).max);
            uint256 shares = v.deposit(10e18, alice);
            vm.stopPrank();
            assertGt(shares, 0);
            assertEq(v.balanceOf(alice), shares);
            assertEq(v.totalAssets(), 10e18, "first deposit is valued at face value");
            assertEq(IERC20(stocks[i]).balanceOf(address(v)), 10e18);
            assertEq(IERC20(stocks[i]).balanceOf(alice), 0);
        }
        assertEq(nvda.totalSupply(), nvda.balanceOf(alice));
        assertEq(spcx.totalSupply(), spcx.balanceOf(alice));
    }

    function test_deterministicAddressIsTheCreate2OfTheInitcode() public {
        StockVault v = _create(NVDA, NVDA_POOL, NVDA_FEED);
        bytes memory initcode = bytes.concat(
            code,
            abi.encode(
                StockVault.Config({
                    stock: NVDA,
                    usdg: USDG,
                    pool: NVDA_POOL,
                    positionManager: NPM,
                    router: ROUTER,
                    feed: NVDA_FEED,
                    owner: vaultOwner,
                    keeper: keeper,
                    treasury: treasury,
                    depositCap: 0
                }),
                _params(),
                "Stock Vault NVDA",
                "svNVDA"
            )
        );
        bytes32 salt = keccak256(abi.encode(NVDA, NVDA_POOL, NVDA_FEED));
        address predicted = address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(factory), salt, keccak256(initcode)))))
        );
        assertEq(address(v), predicted);
    }

    // -------------------------------------------------------------- refusals

    function test_rejectsCreationCodeThatIsNotThePinnedBuild() public {
        bytes memory tampered = code;
        tampered[tampered.length - 1] = bytes1(uint8(tampered[tampered.length - 1]) ^ 0x01);
        vm.prank(factoryOwner);
        vm.expectRevert(VaultFactory.WrongCreationCode.selector);
        factory.createVault(tampered, NVDA, NVDA_POOL, NVDA_FEED, 0);
        assertEq(factory.vaultCount(), 0);
    }

    function test_onlyOwnerCreates() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        factory.createVault(code, NVDA, NVDA_POOL, NVDA_FEED, 0);
    }

    function test_secondVaultForTheSameStockAndPoolReverts() public {
        StockVault v = _create(NVDA, NVDA_POOL, NVDA_FEED);
        vm.prank(factoryOwner);
        vm.expectRevert(abi.encodeWithSelector(VaultFactory.VaultExists.selector, address(v)));
        factory.createVault(code, NVDA, NVDA_POOL, NVDA_FEED, 0);
        assertEq(factory.vaultCount(), 1);
    }

    function test_aPoolOfAnotherTokenBubblesStockVaultsBadConfig() public {
        vm.prank(factoryOwner);
        vm.expectRevert(StockVault.BadConfig.selector);
        factory.createVault(code, NVDA, SPCX_POOL, NVDA_FEED, 0);
        assertEq(factory.vaultCount(), 0);
        assertEq(factory.vaultOf(NVDA, SPCX_POOL), address(0));
    }

    function test_aSecondPoolOfTheSameStockGetsItsOwnVault() public {
        // NVDA/USDG 0.3% pool, from the v3 factory's getPool
        address pool3000 = 0xB944cec30Bd4175855215D767ADC81F39e5f7E2B;
        StockVault a = _create(NVDA, NVDA_POOL, NVDA_FEED);
        StockVault b = _create(NVDA, pool3000, NVDA_FEED);
        assertNotEq(address(a), address(b));
        address[] memory list = factory.vaultsOfStock(NVDA);
        assertEq(list.length, 2);
        assertEq(factory.entryAt(1).feeTier, 3000);
    }

    // ---------------------------------------------------------------- registry

    function test_entriesPaginateAndStopAtTheEnd() public {
        _createThree();
        assertEq(factory.entries(0, 2).length, 2);
        VaultFactory.Entry[] memory tail = factory.entries(2, 10);
        assertEq(tail.length, 1);
        assertEq(tail[0].stock, GOOGL);
        assertEq(factory.entries(3, 10).length, 0);
        assertEq(factory.entries(99, 10).length, 0);
        vm.expectRevert(VaultFactory.OutOfRange.selector);
        factory.entryAt(3);
    }

    function test_newDefaultsApplyToLaterVaultsOnly() public {
        StockVault before = _create(NVDA, NVDA_POOL, NVDA_FEED);
        address newKeeper = makeAddr("newKeeper");
        vm.prank(factoryOwner);
        factory.setDefaults(_defaults(newKeeper));
        StockVault later = _create(SPCX, SPCX_POOL, SPCX_FEED);
        assertEq(before.keeper(), keeper);
        assertEq(later.keeper(), newKeeper);
    }

    function test_defaultsRejectZeroAddresses() public {
        VaultFactory.Defaults memory d = _defaults(keeper);
        d.treasury = address(0);
        vm.prank(factoryOwner);
        vm.expectRevert(VaultFactory.ZeroAddress.selector);
        factory.setDefaults(d);
        vm.expectRevert(VaultFactory.ZeroAddress.selector);
        new VaultFactory(factoryOwner, keccak256(code), d);
    }

    function test_defaultsOutsideStockVaultBoundsRevertAtCreation() public {
        VaultFactory.Defaults memory d = _defaults(keeper);
        d.params.rangeBps = 10; // StockVault requires 50..2000
        vm.prank(factoryOwner);
        factory.setDefaults(d);
        vm.prank(factoryOwner);
        vm.expectRevert(StockVault.BadParams.selector);
        factory.createVault(code, NVDA, NVDA_POOL, NVDA_FEED, 0);
    }
}
