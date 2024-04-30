import { ethereum, BigInt, Address } from "@graphprotocol/graph-ts";
import { BIG_INT_ZERO, ADDRESS_ZERO, BIG_DECIMAL_ZERO } from "const";
import { Pool } from "../../generated/schema";

export function getOrCreatePool(pid: BigInt, block: ethereum.Block): Pool {
    let pool = Pool.load(pid.toString());
  
    if (pool === null) {
      pool = new Pool(pid.toString());
      pool.v3Pool = ADDRESS_ZERO;
      pool.allocPoint = BIG_INT_ZERO;
      pool.allocPoint = BIG_INT_ZERO;
      pool.voltPerSec = BIG_DECIMAL_ZERO;
      pool.wfusePerSec = BIG_DECIMAL_ZERO;
    }
    
    pool.timestamp = block.timestamp;
    pool.block = block.number;
    
    pool.save();

    return pool as Pool;
  }