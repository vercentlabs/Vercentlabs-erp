// Manufacturing from Sales demand (0113): confirmed customer demand, its coverage, and the manufacturing orders assigned to it.
export { DEMAND as DEMAND_PERMISSIONS, DemandError } from "./demand-engine.js";
export {
  allocateManufacturingSupply, attributeReceiptToDemand, createManufacturingOrderFromSales, getDemandReport, getSalesDemand, getSalesManufacturingProgress, listSalesDemand,
  previewManufacturingFromSales, reassignManufacturingSupply, releaseManufacturingAllocation, reserveDemandForSales, setManufacturingItemPolicy,
} from "./demand-service.js";
