export enum DriverState {
  START = 'START',
  WAITING_ID = 'WAITING_ID',
  MENU = 'MENU',
  HELP_MENU = 'HELP_MENU',
  CHOOSING_ROUTE = 'CHOOSING_ROUTE',
}

export interface DriverSession {
  state: DriverState;
  driverId?: number;
  driverName?: string;
  vehicleType?: string;
  availableRoutes?: AvailableRoute[];
  inQueue?: boolean;
}

export interface AvailableRoute {
  atId: string;
  gaiola?: string;
  bairro?: string;
  cidade?: string;
  vehicleType?: string;
}
