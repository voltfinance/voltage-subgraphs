import {
  ADDRESS_ZERO,
  BIG_DECIMAL_1E18,
  BIG_DECIMAL_1E6,
  BIG_DECIMAL_ONE,
  BIG_DECIMAL_ZERO,
  BIG_INT_ZERO,
  FACTORY_ADDRESS,
  VOLT_TOKEN_ADDRESS,
  VOLT_USDC_PAIR_ADDRESS,
  VOLTAGE_START_BLOCK,
  VOLTAGE_WFUSE_USDC_PAIR_ADDRESS,
  USDT_ADDRESS,
  WFUSE_ADDRESS,
} from 'const'
import { Address, BigDecimal, BigInt, ethereum, log } from '@graphprotocol/graph-ts'

import { Factory as FactoryContract } from 'exchange/generated/Factory/Factory'
import { Pair as PairContract } from 'exchange/generated/Factory/Pair'

export function getUSDRate(token: Address, block: ethereum.Block): BigDecimal {
  if (token == USDT_ADDRESS) {
    return BIG_DECIMAL_ONE
  }

  // TODO: add fallback WAVAX_USDT_PAIR_ADDRESS e.g. on pangolin
  //    let address = block.number.le(BigInt.fromI32(10829344))
  //      ? UNISWAP_WETH_USDT_PAIR_ADDRESS
  //      : SUSHISWAP_WETH_USDT_PAIR_ADDRESS
  if (block.number.le(VOLTAGE_START_BLOCK)) {
    return BIG_DECIMAL_ZERO
  }

  let address = VOLTAGE_WFUSE_USDC_PAIR_ADDRESS

  const tokenPriceWFUSE = getFuseRate(token, block)

  const pair = PairContract.bind(address)

  const reservesResult = pair.try_getReserves()
  if (reservesResult.reverted) {
    log.info('[getUSDRate] getReserves reverted', [])
    return BIG_DECIMAL_ZERO
  }
  const reserves = reservesResult.value

  const reserve0 = reserves.value0.toBigDecimal().times(BIG_DECIMAL_1E18)

  const reserve1 = reserves.value1.toBigDecimal().times(BIG_DECIMAL_1E18)

  const avaxPriceUSD = reserve1.div(reserve0).div(BIG_DECIMAL_1E6).times(BIG_DECIMAL_1E18)

  return avaxPriceUSD.times(tokenPriceWFUSE)
}

export function getFuseRate(token: Address, block: ethereum.Block): BigDecimal {
  if (token == WFUSE_ADDRESS) {
    return BIG_DECIMAL_ONE
  }

  // TODO: add fallback, e.g. pangolin
  //    block.number.le(BigInt.fromI32(10829344)) ? UNISWAP_FACTORY_ADDRESS : FACTORY_ADDRESS
  if (block.number.le(VOLTAGE_START_BLOCK)) {
    return BIG_DECIMAL_ZERO
  }
  const factory = FactoryContract.bind(FACTORY_ADDRESS)

  const address = factory.getPair(token, WFUSE_ADDRESS)

  if (address == ADDRESS_ZERO) {
    log.info('Address ZERO...', [])
    return BIG_DECIMAL_ZERO
  }

  const pair = PairContract.bind(address)

  const reservesResult = pair.try_getReserves()
  if (reservesResult.reverted) {
    log.info('[getFuseRate] getReserves reverted', [])
    return BIG_DECIMAL_ZERO
  }
  const reserves = reservesResult.value

  // avoid div by 0
  if (reserves.value0.equals(BIG_INT_ZERO) || reserves.value1.equals(BIG_INT_ZERO)) {
    return BIG_DECIMAL_ZERO
  }

  let fuse =
    pair.token0() == WFUSE_ADDRESS
      ? reserves.value0.toBigDecimal().times(BIG_DECIMAL_1E18).div(reserves.value1.toBigDecimal())
      : reserves.value1.toBigDecimal().times(BIG_DECIMAL_1E18).div(reserves.value0.toBigDecimal())

  return fuse.div(BIG_DECIMAL_1E18)
}

// NOTE: currently using pricing via VOLT/USDT while exchange subgraph is based on JOE/AVAX
// this results in some small discrepancy in VOLT price, and therefore joeHarvestedUSD
// we live with this data point has no impact to front end experience, only analytics
export function getVoltPrice(block: ethereum.Block): BigDecimal {
  if (block.number.lt(VOLTAGE_START_BLOCK)) {
    return BIG_DECIMAL_ZERO
  }
  // TODO: fallback on token price
  //    if (block.number.lt(SOME_BLOCK)) {
  //        return getUSDRate(JOE_TOKEN_ADDRESS, block)
  //    }

  // TODO: fallback on e.g. pangolin
  //    if (block.number.le(SOME_BLOCK)) {
  //        pair = PairContract.bind(SOME_ADDRESS)
  //    }
  const pair = PairContract.bind(VOLT_USDC_PAIR_ADDRESS)

  const reservesResult = pair.try_getReserves()
  if (reservesResult.reverted) {
    log.info('[getVoltPrice] getReserves reverted', [])
    return BIG_DECIMAL_ZERO
  }
  const reserves = reservesResult.value
  if (reserves.value0.toBigDecimal().equals(BigDecimal.fromString('0'))) {
    log.error('[getVoltPrice] USDT reserve 0', [])
    return BIG_DECIMAL_ZERO
  }
  return reserves.value1.toBigDecimal().times(BIG_DECIMAL_1E18).div(reserves.value0.toBigDecimal()).div(BIG_DECIMAL_1E6)
}
