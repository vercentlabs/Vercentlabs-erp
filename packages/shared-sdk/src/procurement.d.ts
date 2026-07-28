export type ProcurementClient={
  dashboard():Promise<unknown>;
  list(resource:string,filters?:Record<string,unknown>):Promise<unknown>;
  get(resource:string,id:string):Promise<unknown>;
  create(resource:string,input:Record<string,unknown>):Promise<unknown>;
  update(resource:string,id:string,input:Record<string,unknown>):Promise<unknown>;
  action(resource:string,id:string,action:string,input?:Record<string,unknown>):Promise<unknown>;
  runMatch(input:Record<string,unknown>):Promise<unknown>;
  report(report:string,filters?:Record<string,unknown>):Promise<unknown>;
};
export declare function createProcurementClient(options?:{baseUrl?:string;fetchImpl?:typeof fetch}):ProcurementClient;
