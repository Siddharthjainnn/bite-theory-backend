import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DeliveryPartner } from './delivery-partner.entity';
import { CreateDeliveryPartnerDto } from './create-delivery-partner.dto';
import { UpdateDeliveryPartnerDto } from './update-delivery-partner.dto';

@Injectable()
export class DeliveryPartnerService {
  constructor(
    @InjectRepository(DeliveryPartner)
    private readonly repo: Repository<DeliveryPartner>,
  ) {}

  findAll() {
    return this.repo.find({ order: { id: 'DESC' } });
  }

  async findOne(id: number) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('DeliveryPartner not found');
    return item;
  }

  create(dto: CreateDeliveryPartnerDto) {
    const item = this.repo.create(dto as Partial<DeliveryPartner>);
    return this.repo.save(item);
  }

  async update(id: number, dto: UpdateDeliveryPartnerDto) {
    await this.findOne(id);
    await this.repo.update(id, dto as Partial<DeliveryPartner>);
    return this.findOne(id);
  }

  async remove(id: number) {
    const item = await this.findOne(id);
    await this.repo.remove(item);
    return { deleted: true, id };
  }

  async updateLocation(id: number, lat: number, lng: number) {
    const item = await this.findOne(id);
    Object.assign(item, { currentLat: lat, currentLng: lng, locationUpdatedAt: new Date() });
    return this.repo.save(item);
  }

  async findByMobile(mobile: string) {
    const item = await this.repo.findOne({ where: { mobile } as any });
    if (!item || item.isActive === false) {
      throw new NotFoundException('No active rider found with this mobile number');
    }
    return item;
  }

  /**
   * Rider login. If RIDER_LOGIN_CODE is set on the server, the rider must
   * supply the matching code (a shared secret you hand out to riders) in
   * addition to their mobile number. If it isn't set, we fall back to the
   * old mobile-only lookup so existing riders keep working after deploy.
   */
  async login(mobile: string, code: string) {
    const expected = process.env.RIDER_LOGIN_CODE;
    if (expected && code !== expected) {
      throw new UnauthorizedException('Invalid rider access code');
    }
    return this.findByMobile(mobile);
  }
}
