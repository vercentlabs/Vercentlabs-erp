export class StockError extends Error {
  constructor(status, message, code = "STOCK_ERROR") {
    super(message);
    this.status = status;
    this.code = code;
  }
}
