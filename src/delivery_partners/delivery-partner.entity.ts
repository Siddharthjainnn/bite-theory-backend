import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'delivery_partners' })
export class DeliveryPartner {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'varchar', name: 'name', nullable: true })
  name: string;

  @Column({ type: 'varchar', name: 'mobile', nullable: true })
  mobile: string;

  @Column({ type: 'varchar', name: 'vehicle_no', nullable: true })
  vehicleNo: string;

  @Column({ type: 'boolean', name: 'is_active', nullable: true })
  isActive: boolean;

  @Column({ type: 'boolean', name: 'is_available', nullable: true })
  isAvailable: boolean;

  @Column({ type: 'timestamptz', name: 'created_at', nullable: true })
  createdAt: Date;

   @Column({ type: 'text', name: 'photo', nullable: true })
  photo: string;

  @Column({ type: 'text', name: 'id_proof', nullable: true })
  idProof: string;

  @Column({ type: 'numeric', name: 'current_lat', precision: 10, scale: 7, nullable: true })
  currentLat: number;

  @Column({ type: 'numeric', name: 'current_lng', precision: 10, scale: 7, nullable: true })
  currentLng: number;

  @Column({ type: 'timestamptz', name: 'location_updated_at', nullable: true })
  locationUpdatedAt: Date;

  /* Shift: only online riders are offered trips. Defaults online (migration). */
  @Column({ type: 'varchar', name: 'shift_status', length: 10, default: 'online' })
  shiftStatus: string;

  /* Bags this rider can carry on one trip. */
  @Column({ type: 'integer', default: 2 })
  capacity: number;
}
