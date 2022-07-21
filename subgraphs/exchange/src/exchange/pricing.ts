import {
  ADDRESS_ZERO,
  BIG_DECIMAL_ONE,
  BIG_DECIMAL_ZERO,
  FACTORY_ADDRESS,
  WHITELIST,
  VOLT_FUSD_PAIR_ADDRESS,
  WFUSE_STABLE_PAIRS,
  WFUSE_ADDRESS,
  USDT_ADDRESS,
  VOLT_TOKEN_ADDRESS,
  VOLTAGE_START_BLOCK,
} from 'const'
import { Address, BigDecimal, ethereum, log } from '@graphprotocol/graph-ts'
import { Pair, Token } from '../../generated/schema'

import { Factory as FactoryContract } from '../../generated/Factory/Factory'

export const factoryContract = FactoryContract.bind(FACTORY_ADDRESS)

/*
 * Base VOLT price using VOLT/FUSE * FUSE. 
 * WAvg price would be better, but VOLT/FUSE is bulk of liquidity. 
 */
export function getVoltPrice(block: ethereum.Block = null): BigDecimal {
  const fuse_rate = getFuseRate(VOLT_TOKEN_ADDRESS)
  const fuse_price = getFusePrice()
  const price = fuse_rate.times(fuse_price)
  return price
}

/*
 * VOLT price is the weighted average of VOLT/WFUSE * FUSE and VOLT/USDT.
 *
 */
export function getWavgVoltPrice(block: ethereum.Block = null): BigDecimal {
  // get JOE/USDT
  const usdt_pair = Pair.load(VOLT_FUSD_PAIR_ADDRESS.toString())
  const usdt_price = usdt_pair
    ? usdt_pair.token0 == VOLT_TOKEN_ADDRESS.toHexString()
      ? usdt_pair.token1Price
      : usdt_pair.token0Price
    : BIG_DECIMAL_ZERO
  const usdt_weight = usdt_pair
    ? usdt_pair.token0 == VOLT_TOKEN_ADDRESS.toHexString()
      ? usdt_pair.reserve0
      : usdt_pair.reserve1
    : BIG_DECIMAL_ZERO

  // get VOLT/FUSE
  const volt_wfuse_address = factoryContract.getPair(VOLT_TOKEN_ADDRESS, WFUSE_ADDRESS)
  const fuse_pair = Pair.load(volt_wfuse_address.toString())
  const fuse_rate = fuse_pair
    ? fuse_pair.token0 == VOLT_TOKEN_ADDRESS.toHexString()
      ? fuse_pair.token1Price
      : fuse_pair.token0Price
    : BIG_DECIMAL_ZERO
  const fuse_weight = fuse_pair
    ? fuse_pair.token0 == VOLT_TOKEN_ADDRESS.toHexString()
      ? fuse_pair.reserve0
      : fuse_pair.reserve1
    : BIG_DECIMAL_ZERO
  const fuse_price = fuse_rate.times(getFusePrice())

  // weighted avg
  const sumprod = usdt_price.times(usdt_weight).plus(fuse_price.times(fuse_weight))
  const sumweights = usdt_weight.plus(fuse_weight)
  const wavg = sumprod.div(sumweights)
  return wavg
}

/*
 * Bundle tracks the price of AVAX, it is used to convert from AVAX price to USD price.
 * Exchange subgraph only keeps 1 bundle; it is updated during factory sync() event.
 *
 * This is different from getAvaxRate which calculates AVAX price for token, as it only
 * calculates price in USD for AVAX.
 *
 * AVAX price is calculated by getting weighted average of stable-coin pairs.
 *
 */
export function getFusePrice(block: ethereum.Block = null): BigDecimal {
  let total_weight = BIG_DECIMAL_ZERO
  let sum_price = BIG_DECIMAL_ZERO

  for (let i = 0; i < WFUSE_STABLE_PAIRS.length; ++i) {
    const pair_address = WFUSE_STABLE_PAIRS[i]
    const pair = Pair.load(pair_address)
    const price = _getFusePrice(pair)
    const weight = _getFuseReserve(pair)

    total_weight = total_weight.plus(weight)
    sum_price = sum_price.plus(price.times(weight))
    log.debug('getAvaxPrice, address: {}, price: {}, weight: {}', [pair_address, price.toString(), weight.toString()])
  }

  // div by 0
  const fuse_price = total_weight.equals(BIG_DECIMAL_ZERO) ? BIG_DECIMAL_ZERO : sum_price.div(total_weight)
  return fuse_price
}

// returns fuse price given e.g. fuse-usdt or fuse-dai pair
function _getFusePrice(pair: Pair | null): BigDecimal {
  if (pair == null) {
    return BIG_DECIMAL_ZERO
  }
  const fuse = pair.token0 == WFUSE_ADDRESS.toHexString() ? pair.token1Price : pair.token0Price
  return fuse
}

// returns fuse reserves given e.g. fuse-usdt or fuse-dai pair
function _getFuseReserve(pair: Pair | null): BigDecimal {
  if (pair == null) {
    return BIG_DECIMAL_ZERO
  }
  const fuse = pair.token0 == WFUSE_ADDRESS.toHexString() ? pair.reserve0 : pair.reserve1
  return fuse
}

/*
 * Get price of token in Fuse.
 * Loop through WHITELIST to get Fuse/Token rate.
 */
export function getFuseRate(address: Address): BigDecimal {
  if (address == WFUSE_ADDRESS) {
    return BIG_DECIMAL_ONE
  }
  // TODO: This is slow, and this function is called quite often.
  // What could we do to improve this?
  for (let i = 0; i < WHITELIST.length; ++i) {
    // TODO: Cont. This would be a good start, by avoiding multiple calls to getPair...
    const pairAddress = factoryContract.getPair(address, Address.fromString(WHITELIST[i]))

    if (pairAddress != ADDRESS_ZERO) {
      const pair = Pair.load(pairAddress.toHex())
      if (pair.token0 == address.toHexString()) {
        const token1 = Token.load(pair.token1)
        return pair.token1Price.times(token1.derivedETH as BigDecimal) // return token1 per our token * FUSE per token 1
      }
      if (pair.token1 == address.toHexString()) {
        const token0 = Token.load(pair.token0)
        return pair.token0Price.times(token0.derivedETH as BigDecimal) // return token0 per our token * FUSE   per token 0
      }
    }
  }

  return BIG_DECIMAL_ZERO // nothing was found return 0
}

/*
 * Get price of token in USD.
 */
export function getUSDRate(address: Address, block: ethereum.Block = null): BigDecimal {
  if (address == USDT_ADDRESS) {
    return BIG_DECIMAL_ONE
  }

  const fuseRate = getFuseRate(address)
  const fusePrice = getFusePrice()

  return fuseRate.times(fusePrice)
}
