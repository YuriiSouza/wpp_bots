import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { DriversService } from './drivers.service';

@Controller()
export class DriversController {
  constructor(private readonly driversService: DriversService) {}

  @Get('api/drivers')
  async getDrivers() {
    return this.driversService.getDrivers();
  }

  @Patch('api/drivers/:driverId/priority-score')
  async updateDriverPriorityScore(
    @Param('driverId') driverId: string,
    @Body('priorityScore') priorityScore: number,
  ) {
    return this.driversService.updateDriverPriorityScore(driverId, priorityScore);
  }

  @Post('api/drivers/:driverId/reset-no-show')
  async resetDriverNoShow(@Param('driverId') driverId: string) {
    return this.driversService.resetDriverNoShow(driverId);
  }

  @Get('api/blocklist')
  async getBlocklist() {
    return this.driversService.getBlocklist();
  }

  @Post('acess/analist/blocklist/add')
  @Post('acess/analist/blacklist/add')
  async addBlocklistDriver(
    @Body('driverId') driverId: string,
    @Body('reason') reason?: string,
  ) {
    return this.driversService.addBlocklistDriver(driverId, reason);
  }

  @Post('acess/analist/blocklist/remove')
  @Post('acess/analist/blacklist/remove')
  async removeBlocklistDriver(@Body('driverId') driverId: string) {
    return this.driversService.removeBlocklistDriver(driverId);
  }
}
