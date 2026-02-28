import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { RoutesAdminService } from './routes-admin.service';

@Controller()
export class RoutesAdminController {
  constructor(private readonly routesAdminService: RoutesAdminService) {}

  @Get('api/routes')
  async getRoutes() {
    return this.routesAdminService.getRoutes();
  }

  @Post('api/routes/:routeId/assign')
  async assignRoute(
    @Param('routeId') routeId: string,
    @Body('driverId') driverId: string,
  ) {
    return this.routesAdminService.assignRoute(routeId, driverId);
  }

  @Post('api/routes/:routeId/unassign')
  async unassignRoute(@Param('routeId') routeId: string) {
    return this.routesAdminService.unassignRoute(routeId);
  }

  @Post('api/routes/:routeId/block')
  async blockRoute(@Param('routeId') routeId: string) {
    return this.routesAdminService.blockRoute(routeId);
  }
}
