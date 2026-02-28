export enum DriverState {
  START = 'START',
  WAITING_ID = 'WAITING_ID',
  MENU = 'MENU',
  HELP_MENU = 'HELP_MENU',
  CHOOSING_ROUTE = 'CHOOSING_ROUTE',
  SUPPORT_CHAT = 'SUPPORT_CHAT',
}

export interface DriverSession {
  state: DriverState;
  driverId?: string;
  driverName?: string;
  vehicleType?: string;
  ds?: string;
  priorityScore?: number;
  availableRoutes?: AvailableRoute[];
  inQueue?: boolean;
  queueGroup?: 'moto' | 'general';
  supportTicketId?: string;
}

export interface AvailableRoute {
  routeId: string;
  atId: string;
  gaiola?: string;
  bairro?: string;
  cidade?: string;
  vehicleType?: string;
}
