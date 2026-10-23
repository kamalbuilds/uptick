// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {StockVault} from "../src/StockVault.sol";
import {StockVaultV4} from "../src/v4/StockVaultV4.sol";
import {VaultFactory} from "../src/VaultFactory.sol";

interface IHealthVault {
    function health()
        external
        view
        returns (uint8 status, uint256 price, uint256 updatedAt, uint160 sqrtOracle, uint160 sqrtTwap, uint160 sqrtSpot);
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    function redeemInKind(uint256 shares, address receiver, address owner_)
        external
        returns (uint256 stockOut, uint256 usdgOut);
    function maxDeposit(address) external view returns (uint256);
    function totalAssets() external view returns (uint256);
    function balanceOf(address) external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function depositCap() external view returns (uint256);
    function entryFee() external view returns (uint24);
    function instantDeploy() external view returns (bool);
    function poke() external returns (bool);
    /// @dev StockVault.PositionInfo and StockVaultV4.PositionInfo differ only in the first word (tokenId vs open).
    function positionInfo()
        external
        view
        returns (uint256 idOrOpen, int24 lo, int24 hi, uint128 liquidity, uint256 s, uint256 u, uint256 fs, uint256 fu, bool inRange);
}

/// @notice Read-only health matrix. Forks the chain it is pointed at, deploys the open vaults through a throwaway
/// VaultFactory with the deploy list's cap and band (the same Params DeployAll applies), and against the REAL feeds,
/// pools and Stock Tokens (nothing is mocked, nothing is broadcast) records for each vault:
///   1. health(): status, price, feed age, oracle/TWAP/spot gaps in bp;
///   2. deposit of $1,000 of Stock Token: accepted or refused with the vault's own revert reason;
///   3. the deploy swap at 100%, 50%, 25%, 12.5% of the deposit cap, sell side (Stock Token in, half swapped to USDG)
///      and buy side (USDG parked in the vault, half swapped to Stock Token). instantDeploy is forced on in the
///      simulation, so the deposit runs the same balance-swap-and-mint a keeper rebalance runs, against the Chainlink
///      floor. A healthy vault that cannot deploy its full cap in either direction is a liveness failure;
///   4. redeemInKind of the shares, next block: the Stock Token and USDG returned against what went in. It reads no
///      oracle, so it must work whatever health says; when the oracle refuses the deposit, forged shares are used.
/// Verdict lines are machine greppable. The script reverts (non-zero exit) when redeemInKind fails or loses more than
/// 1% of the value, or when a healthy vault cannot deploy its own cap. A refused deposit on an unhealthy feed
/// (FeedStale at a weekend, TwapUnavailable, CorporateAction) is a recorded outcome, not a failure.
/// A v4 vault keeps its TWAP in its own ring, which a fresh vault has not filled: the simulation pokes it every 60 s
/// for 11 minutes (block.timestamp warped, feed untouched) so health() has a window, as the keeper's minute poke
/// gives a launched vault.
/// Run (see contracts/README.md "Health matrix"):
///   node scripts/deploy-list.mjs --open-only contracts/test-logs/deploy-list.json
///   cd contracts && DEPLOY_LIST=test-logs/deploy-list.json forge script script/HealthMatrix.s.sol --rpc-url robinhood -vv
/// Env: DEPLOY_LIST (required), SYMBOLS (comma list, default AAPL,GOOGL,PLTR, the vaults whose evidence gate is open),
/// WARP_SECONDS (optional what-if: age the real feeds by this many seconds to see the stale branch).
contract HealthMatrix is Script, StdCheats {
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant NPM = 0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3;
    address constant ROUTER = 0xCaf681a66D020601342297493863E78C959E5cb2;
    address constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;

    address constant OWNER = address(uint160(uint256(keccak256("uptick.healthmatrix.owner"))));
    address constant KEEPER = address(uint160(uint256(keccak256("uptick.healthmatrix.keeper"))));
    address constant TREASURY = address(uint160(uint256(keccak256("uptick.healthmatrix.treasury"))));
    address constant USER = address(uint160(uint256(keccak256("uptick.healthmatrix.user"))));

    struct Row {
        string sym;
        bool v4;
        string health;
        string deposit;
        string deploy;
        string exitKind;
        bool bad;
    }

    VaultFactory factory;

    function run() external {
        require(block.chainid == 4663, "not Robinhood Chain");
        string memory json = vm.readFile(vm.envString("DEPLOY_LIST"));
        string memory symbols = vm.envOr("SYMBOLS", string("AAPL,GOOGL,PLTR"));
        string[] memory want = _split(symbols);

        console2.log("== Uptick health matrix");
        console2.log("block", vm.getBlockNumber());
        console2.log("utc timestamp", vm.getBlockTimestamp());
        console2.log("utc weekday (0=Sun)", (vm.getBlockTimestamp() / 1 days + 4) % 7);
        console2.log("utc hour", (vm.getBlockTimestamp() % 1 days) / 1 hours);

        uint256 warpBy = vm.envOr("WARP_SECONDS", uint256(0));
        if (warpBy != 0) {
            // what-if only: moves block.timestamp forward over the real feeds, which then age; the real weekend run is
            // this script with WARP_SECONDS unset on that day
            vm.warp(vm.getBlockTimestamp() + warpBy);
            console2.log("WHAT-IF: warped seconds", warpBy);
        }

        bytes memory code = type(StockVault).creationCode;
        bytes memory code4 = type(StockVaultV4).creationCode;
        StockVault.Params memory p = StockVault.Params({
            rangeBps: 500,
            perfFeeBps: 0,
            maxDeviationBps: 100,
            slippageBps: 100,
            exitBufferBps: 30,
            maxStaleness: 90_000,
            twapWindow: 600,
            minRebalanceInterval: 6 hours
        });
        factory = new VaultFactory(
            OWNER,
            keccak256(code),
            keccak256(code4),
            POOL_MANAGER,
            VaultFactory.Defaults({
                usdg: USDG, positionManager: NPM, router: ROUTER, vaultOwner: OWNER, keeper: KEEPER, treasury: TREASURY, params: p
            })
        );

        uint256 seen;
        Row[] memory rows = new Row[](want.length);
        for (uint256 w; w < want.length; ++w) {
            uint256 idx = _find(json, want[w]);
            string memory k = string.concat(".[", vm.toString(idx), "]");
            uint16 range = uint16(vm.parseJsonUint(json, string.concat(k, ".rangeBps")));
            if (range != p.rangeBps) {
                p.rangeBps = range;
                vm.prank(OWNER);
                factory.setDefaults(
                    VaultFactory.Defaults({
                        usdg: USDG, positionManager: NPM, router: ROUTER, vaultOwner: OWNER, keeper: KEEPER, treasury: TREASURY, params: p
                    })
                );
            }
            bool v4 = _isV4(json, k);
            address token = vm.parseJsonAddress(json, string.concat(k, ".token"));
            address feed = vm.parseJsonAddress(json, string.concat(k, ".feed"));
            uint256 capTokens = vm.parseJsonUint(json, string.concat(k, ".depositCapTokens"));
            address vault;
            if (v4) {
                address hooks = vm.parseJsonAddress(json, string.concat(k, ".hooks"));
                if (hooks != address(0)) {
                    vm.prank(OWNER);
                    factory.setHookAllowed(hooks, true);
                }
                vm.prank(OWNER);
                vault = factory.createVaultV4(
                    code4,
                    token,
                    uint24(vm.parseJsonUint(json, string.concat(k, ".feeTier"))),
                    int24(int256(vm.parseJsonUint(json, string.concat(k, ".tickSpacing")))),
                    hooks,
                    feed,
                    capTokens
                );
            } else {
                vm.prank(OWNER);
                vault = factory.createVault(code, token, vm.parseJsonAddress(json, string.concat(k, ".pool")), feed, capTokens);
            }
            uint256 snap = vm.snapshotState();
            rows[seen++] = _probe(want[w], IHealthVault(vault), IERC20(token), v4, vm.parseJsonUint(json, string.concat(k, ".capUsd")));
            vm.revertToState(snap);
        }

        console2.log("== VERDICT (sym | venue | health | $1,000 deposit | deploy swap at 100/50/25/12.5% of cap | redeemInKind)");
        for (uint256 i; i < seen; ++i) {
            console2.log(
                string.concat(
                    rows[i].sym, " | ", rows[i].v4 ? "v4" : "v3", " | ", rows[i].health, " | ", rows[i].deposit, " | ", rows[i].deploy, " | ", rows[i].exitKind
                )
            );
        }
        uint256 failures;
        for (uint256 i; i < seen; ++i) {
            if (rows[i].bad) ++failures;
        }
        console2.log("failures", failures);
        require(failures == 0, "health matrix: a vault failed (see FAIL lines)");
    }

    // ---------------------------------------------------------------- probe

    function _probe(string memory sym, IHealthVault v, IERC20 stock, bool v4, uint256 capUsd) internal returns (Row memory r) {
        r.sym = sym;
        r.v4 = v4;
        console2.log(string.concat("---- ", sym, v4 ? " (StockVaultV4)" : " (StockVault)"), address(v));
        console2.log("deposit cap, Stock Token wei", v.depositCap());
        console2.log("deposit cap, USD (deploy list)", capUsd);
        console2.log("entry fee, pool-fee pips", v.entryFee());

        if (v4) _primeV4Oracle(v);
        (uint8 st, uint256 price, uint256 updatedAt, uint160 so, uint160 stw, uint160 ssp) = v.health();
        r.health = _statusName(st);
        console2.log("health status", r.health);
        console2.log("feed price, 8 dec", price);
        console2.log("feed age, seconds", vm.getBlockTimestamp() - updatedAt);
        console2.log("TWAP vs oracle, bp", _gapBp(stw, so));
        console2.log("spot vs oracle, bp", _gapBp(ssp, so));
        console2.log("spot vs TWAP, bp", _gapBp(ssp, stw));

        uint256 snap = vm.snapshotState();

        // 2. $1,000 deposit, plain (instantDeploy off, as launched)
        uint256 small = price == 0 ? 0 : 1000e6 * 1e20 / price;
        uint256 smallShares;
        (bool ok, bytes memory ret) = _deposit(v, stock, small);
        if (ok) {
            smallShares = abi.decode(ret, (uint256));
            r.deposit = string.concat("accepted, shares ", vm.toString(smallShares));
        } else {
            r.deposit = string.concat("refused: ", _why(ret));
        }
        console2.log("1000 USD deposit", r.deposit);
        vm.revertToState(snap);

        // 3. deploy swap at fractions of the cap, instantDeploy forced on in the simulation. Sell side: the deposit is
        // all Stock Token, so the deploy swaps half of it to USDG. Buy side: the vault holds USDG (a position pulled out
        // of range above spot holds only USDG) and a small Stock Token deposit triggers the deploy, which swaps half of
        // the USDG to Stock Token.
        _forceInstantDeploy(v);
        uint256 cap = v.depositCap();
        uint256[4] memory fracBp = [uint256(10000), 5000, 2500, 1250];
        string memory deployStr;
        bool fullOk = true;
        for (uint256 i; i < fracBp.length; ++i) {
            uint256 amt = cap * fracBp[i] / 1e4;
            (string memory sellCell, string memory exitStr, bool sellOk) = _deployCell(v, stock, amt, price, false, i == 0);
            (string memory buyCell,, bool buyOk) = _deployCell(v, stock, amt, price, true, false);
            if (i == 0) {
                fullOk = sellOk && buyOk;
                r.exitKind = exitStr;
            }
            console2.log(string.concat("deploy at ", vm.toString(fracBp[i]), " bp of cap, sell side / buy side"), string.concat(sellCell, " / ", buyCell));
            deployStr = string.concat(deployStr, i == 0 ? "" : "; ", vm.toString(fracBp[i]), " bp: ", sellCell, "/", buyCell);
        }
        r.deploy = deployStr;
        vm.revertToState(snap);

        // a healthy vault must deploy its full cap in both directions; an unhealthy one is a recorded outcome
        if (st == 0 && !fullOk) {
            r.bad = true;
            console2.log(string.concat("FAIL ", sym, ": healthy vault cannot deploy its full cap in one swap"));
        }

        // 4. redeemInKind must work whatever health says
        if (bytes(r.exitKind).length == 0) {
            r.exitKind = _forgedExit(v, stock, price);
        }
        if (_startsWith(r.exitKind, "FAIL")) {
            r.bad = true;
            console2.log(string.concat("FAIL ", sym, ": ", r.exitKind));
        }
    }

    /// @dev One deploy attempt in its own snapshot. With `exitAfter` and a landed position, the shares are redeemed in
    /// kind the next block before the snapshot is reverted.
    function _deployCell(IHealthVault v, IERC20 stock, uint256 amt, uint256 price, bool buy, bool exitAfter)
        internal
        returns (string memory cell, string memory exitStr, bool landed)
    {
        uint256 snap = vm.snapshotState();
        uint256 depositAmt = amt;
        if (buy) {
            // USDG worth 99% of `amt` parked in the vault, then a Stock Token deposit of 0.5% of `amt` (inside the 1% of room)
            deal(USDG, address(v), amt * price / 1e20 * 99 / 100);
            depositAmt = amt / 200;
        }
        (bool ok, bytes memory ret) = _deposit(v, stock, depositAmt);
        if (ok) {
            (,,, uint128 liq,,,,,) = v.positionInfo();
            landed = liq > 0;
            cell = landed ? "OK" : "idle";
            if (exitAfter && landed) exitStr = _exitInKind(v, depositAmt, price, abi.decode(ret, (uint256)));
        } else {
            cell = string.concat("REFUSED ", _why(ret));
        }
        vm.revertToState(snap);
    }

    /// @dev After a deployed deposit: next block, redeem every share in kind and price both legs at the feed.
    function _exitInKind(IHealthVault v, uint256 amtIn, uint256 price, uint256 shares)
        internal
        returns (string memory)
    {
        vm.roll(vm.getBlockNumber() + 1);
        uint256 pos = shares == 0 ? v.balanceOf(USER) : shares;
        vm.prank(USER);
        (bool ok, bytes memory ret) = address(v).call(abi.encodeCall(IHealthVault.redeemInKind, (pos, USER, USER)));
        if (!ok) return string.concat("FAIL redeemInKind reverted: ", _why(ret));
        (uint256 sOut, uint256 uOut) = abi.decode(ret, (uint256, uint256));
        // value in USDG units (6 dec): stock wei * price(8 dec) / 1e20
        uint256 backUsd = sOut * price / 1e20 + uOut;
        uint256 inUsd = amtIn * price / 1e20;
        uint256 retBp = inUsd == 0 ? 0 : backUsd * 1e4 / inUsd;
        console2.log("redeemInKind (after the 100% deploy) stock out wei", sOut);
        console2.log("redeemInKind usdg out (6 dec)", uOut);
        console2.log("returned / deposited, bp of value", retBp);
        // the entry fee stays with the holders and a deployed deposit paid half a swap (fee plus impact, under 100 bp
        // of the half): giving back less than 99% of the value is a leak, not a cost
        uint256 floorBp = 9900;
        if (retBp < floorBp) {
            return string.concat("FAIL redeemInKind returned ", vm.toString(retBp), " bp of the deposit, floor ", vm.toString(floorBp));
        }
        return string.concat("OK ", vm.toString(retBp), " bp back (stock ", vm.toString(sOut), " wei, usdg ", vm.toString(uOut), ")");
    }

    /// @dev Oracle refused every deposit: park Stock Token in the vault, hand USER the shares through storage, and
    /// redeem in kind. Proves the exit has no oracle gate on the day the gate is closed. Labelled forged.
    function _forgedExit(IHealthVault v, IERC20 stock, uint256 price) internal returns (string memory) {
        uint256 snap = vm.snapshotState();
        uint256 amt = price == 0 ? 1e18 : 1000e6 * 1e20 / price;
        deal(address(stock), address(v), amt);
        deal(address(v), USER, 1e6 * amt, true);
        vm.roll(vm.getBlockNumber() + 1);
        uint256 forged = v.balanceOf(USER);
        vm.prank(USER);
        (bool ok, bytes memory ret) = address(v).call(abi.encodeCall(IHealthVault.redeemInKind, (forged, USER, USER)));
        string memory out;
        if (!ok) {
            out = string.concat("FAIL redeemInKind (forged shares) reverted: ", _why(ret));
        } else {
            (uint256 sOut,) = abi.decode(ret, (uint256, uint256));
            out = sOut * 1e4 / amt >= 9990
                ? string.concat("OK (forged shares) ", vm.toString(sOut * 1e4 / amt), " bp of the parked stock back")
                : string.concat("FAIL redeemInKind (forged shares) returned only ", vm.toString(sOut * 1e4 / amt), " bp");
        }
        console2.log("redeemInKind forged", out);
        vm.revertToState(snap);
        return out;
    }

    // ------------------------------------------------------------ helpers

    function _deposit(IHealthVault v, IERC20 stock, uint256 amt) internal returns (bool ok, bytes memory ret) {
        deal(address(stock), USER, amt);
        vm.startPrank(USER);
        stock.approve(address(v), amt);
        (ok, ret) = address(v).call(abi.encodeCall(IHealthVault.deposit, (amt, USER)));
        vm.stopPrank();
    }

    /// @dev Flips `instantDeploy` on a fresh vault without touching its packed neighbours: find its slot, then the
    /// byte inside it whose 0x01 makes the public getter read true. Reverts if no byte does.
    function _forceInstantDeploy(IHealthVault v) internal {
        require(!v.instantDeploy(), "instantDeploy already on");
        bytes32 slot = _slotOfInstantDeploy(v);
        bytes32 old = vm.load(address(v), slot);
        for (uint256 o; o < 32; ++o) {
            vm.store(address(v), slot, bytes32(uint256(old) | (uint256(1) << (o * 8))));
            if (v.instantDeploy()) return;
        }
        revert("could not flip instantDeploy");
    }

    function _slotOfInstantDeploy(IHealthVault v) internal returns (bytes32) {
        // scan the vault's first 40 storage slots for the one whose change flips the getter
        for (uint256 s; s < 40; ++s) {
            bytes32 slot = bytes32(s);
            bytes32 old = vm.load(address(v), slot);
            for (uint256 o; o < 32; ++o) {
                vm.store(address(v), slot, bytes32(uint256(old) | (uint256(1) << (o * 8))));
                if (v.instantDeploy()) {
                    vm.store(address(v), slot, old);
                    return slot;
                }
            }
            vm.store(address(v), slot, old);
        }
        revert("instantDeploy slot not found");
    }

    function _primeV4Oracle(IHealthVault v) internal {
        for (uint256 i; i < 12; ++i) {
            v.poke();
            vm.warp(vm.getBlockTimestamp() + 60);
        }
        v.poke();
    }

    function _find(string memory json, string memory sym) internal view returns (uint256) {
        for (uint256 i; vm.keyExistsJson(json, string.concat(".[", vm.toString(i), "]")); ++i) {
            if (keccak256(bytes(vm.parseJsonString(json, string.concat(".[", vm.toString(i), "].symbol")))) == keccak256(bytes(sym))) {
                return i;
            }
        }
        revert(string.concat(sym, " is not in the deploy list"));
    }

    function _isV4(string memory json, string memory k) private view returns (bool) {
        string memory vk = string.concat(k, ".venue");
        return vm.keyExistsJson(json, vk) && keccak256(bytes(vm.parseJsonString(json, vk))) == keccak256("v4");
    }

    function _gapBp(uint160 a, uint160 b) internal pure returns (uint256) {
        if (a == 0 || b == 0) return 0;
        uint256 pa = uint256(a) * uint256(a) / (1 << 96);
        uint256 pb = uint256(b) * uint256(b) / (1 << 96);
        uint256 hi = pa > pb ? pa : pb;
        uint256 lo = pa > pb ? pb : pa;
        return lo == 0 ? 0 : (hi - lo) * 1e4 / lo;
    }

    function _statusName(uint8 s) internal pure returns (string memory) {
        string[7] memory n = ["Ok", "FeedInvalid", "FeedStale", "TwapUnavailable", "TwapDeviates", "SpotDeviates", "CorporateAction"];
        return s < 7 ? n[s] : "Unknown";
    }

    function _why(bytes memory ret) internal pure returns (string memory) {
        if (ret.length < 4) return "empty revert";
        bytes4 sel;
        assembly ("memory-safe") {
            sel := mload(add(ret, 0x20))
        }
        if (sel == StockVault.OracleUnhealthy.selector && ret.length >= 36) {
            uint8 st;
            assembly ("memory-safe") {
                st := mload(add(ret, 0x24))
            }
            return string.concat("OracleUnhealthy(", _statusName(st), ")");
        }
        if (sel == 0x08c379a0) {
            bytes memory body = new bytes(ret.length - 4);
            for (uint256 i; i < body.length; ++i) {
                body[i] = ret[i + 4];
            }
            return abi.decode(body, (string));
        }
        return string.concat("selector ", vm.toString(sel));
    }

    function _startsWith(string memory s, string memory pre) internal pure returns (bool) {
        bytes memory a = bytes(s);
        bytes memory b = bytes(pre);
        if (a.length < b.length) return false;
        for (uint256 i; i < b.length; ++i) {
            if (a[i] != b[i]) return false;
        }
        return true;
    }

    function _split(string memory csv) internal pure returns (string[] memory out) {
        bytes memory b = bytes(csv);
        uint256 n = 1;
        for (uint256 i; i < b.length; ++i) {
            if (b[i] == ",") ++n;
        }
        out = new string[](n);
        uint256 start;
        uint256 j;
        for (uint256 i; i <= b.length; ++i) {
            if (i == b.length || b[i] == ",") {
                bytes memory part = new bytes(i - start);
                for (uint256 k; k < part.length; ++k) {
                    part[k] = b[start + k];
                }
                out[j++] = string(part);
                start = i + 1;
            }
        }
    }
}
