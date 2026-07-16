import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'roles' })
export class Role {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'varchar', name: 'name', nullable: true })
  name: string;

  @Column({ type: 'text', name: 'description', nullable: true })
  description: string;

  /**
   * Which admin sidebar sections this role may open, e.g.
   * ['dashboard','orders','products'].
   *
   * Previously this map was HARD-CODED in the admin frontend, so changing what
   * a Kitchen Manager could see meant a code change + redeploy. Storing it here
   * lets a super_admin configure roles from the UI.
   *
   * NULL/empty = fall back to the app's built-in defaults for that role name.
   */
  @Column({ type: 'jsonb', name: 'sections', nullable: true })
  sections: string[] | null;

}
