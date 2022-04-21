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
 * Base JOE price using JOE/AVAX * AVAX. 
 * WAvg price would be better, but JOE/AVAX is bulk of liquidity. 
 */
export function getJoePrice(block: ethereum.Block = null): BigDecimal {
  const avax_rate = getAvaxRate(VOLT_TOKEN_ADDRESS)
  const avax_price = getAvaxPrice()
  const price = avax_rate.times(avax_price)
  return price
}

/*
 * VOLT price is the weighted average of VOLT/WFUSE * WFUSE and VOLT/USDC.
 *
 */
export function getWavgJoePrice(block: ethereum.Block = null): BigDecimal {
  // get VOLT/USDC
  const fusdPair = Pair.load(VOLT_FUSD_PAIR_ADDRESS.toString())
  const fusdPrice = fusdPair
    ? fusdPair.token0 == VOLT_TOKEN_ADDRESS.toHexString()
      ? fusdPair.token1Price
      : fusdPair.token0Price
    : BIG_DECIMAL_ZERO
  const fusdWeight = fusdPair
    ? fusdPair.token0 == VOLT_TOKEN_ADDRESS.toHexString()
      ? fusdPair.reserve0
      : fusdPair.reserve1
    : BIG_DECIMAL_ZERO

  // get VOLT/WFUSE
  const voltWfuseAddress = factoryContract.getPair(VOLT_TOKEN_ADDRESS, WFUSE_ADDRESS)
  const wfusePair = Pair.load(voltWfuseAddress.toString())
  const wfuseRate = wfusePair
    ? wfusePair.token0 == VOLT_TOKEN_ADDRESS.toHexString()
      ? wfusePair.token1Price
      : wfusePair.token0Price
    : BIG_DECIMAL_ZERO
  const wfuseWeight = wfusePair
    ? wfusePair.token0 == VOLT_TOKEN_ADDRESS.toHexString()
      ? wfusePair.reserve0
      : wfusePair.reserve1
    : BIG_DECIMAL_ZERO
  const wfusePrice = wfuseRate.times(getAvaxPrice())

  // weighted avg
  const sumprod = fusdPrice.times(fusdWeight).plus(wfusePrice.times(wfuseWeight))
  const sumweights = fusdWeight.plus(wfuseWeight)
  const weightedAverage = sumprod.div(sumweights)
  return weightedAverage
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
export function getAvaxPrice(block: ethereum.Block = null): BigDecimal {
  let total_weight = BIG_DECIMAL_ZERO
  let sum_price = BIG_DECIMAL_ZERO

  for (let i = 0; i < WFUSE_STABLE_PAIRS.length; ++i) {
    const pair_address = WFUSE_STABLE_PAIRS[i]
    const pair = Pair.load(pair_address)
    const price = _getAvaxPrice(pair)
    const weight = _getAvaxReserve(pair)

    total_weight = total_weight.plus(weight)
    sum_price = sum_price.plus(price.times(weight))
    log.debug('getAvaxPrice, address: {}, price: {}, weight: {}', [pair_address, price.toString(), weight.toString()])
  }

  // div by 0
  const avax_price = total_weight.equals(BIG_DECIMAL_ZERO) ? BIG_DECIMAL_ZERO : sum_price.div(total_weight)
  return avax_price
}

// returns avax price given e.g. avax-usdt or avax-dai pair
function _getAvaxPrice(pair: Pair | null): BigDecimal {
  if (pair == null) {
    return BIG_DECIMAL_ZERO
  }
  const avax = pair.token0 == WFUSE_ADDRESS.toHexString() ? pair.token1Price : pair.token0Price
  return avax
}

// returns avax reserves given e.g. avax-usdt or avax-dai pair
function _getAvaxReserve(pair: Pair | null): BigDecimal {
  if (pair == null) {
    return BIG_DECIMAL_ZERO
  }
  const avax = pair.token0 == WFUSE_ADDRESS.toHexString() ? pair.reserve0 : pair.reserve1
  return avax
}

/*
 * Get price of token in Avax.
 * Loop through WHITELIST to get Avax/Token rate.
 */
export function getAvaxRate(address: Address): BigDecimal {
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
        return pair.token1Price.times(token1.derivedETH as BigDecimal) // return token1 per our token * AVAX per token 1
      }
      if (pair.token1 == address.toHexString()) {
        const token0 = Token.load(pair.token0)
        return pair.token0Price.times(token0.derivedETH as BigDecimal) // return token0 per our token * AVAX per token 0
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

  const avaxRate = getAvaxRate(address)
  const avaxPrice = getAvaxPrice()

  return avaxRate.times(avaxPrice)
}
