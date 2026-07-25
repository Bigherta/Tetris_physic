// ============================================================
//  physics.js  —  Minimal 2D rigid-body engine for Physics Tetris
//
//  Conventions
//  -----------
//  - Screen coordinates: +x right, +y DOWN.
//  - A tetromino is one rigid body made of N unit squares ("cells"),
//    each a square of side BLOCK px.
//  - Positive angular velocity = clockwise rotation on screen.
//  - Point velocity at offset r from COM:  (v.x - w*r.y , v.y + w*r.x)
//  - Contact normal n points from A toward B.
//  - Relative velocity vrel = vB_point - vA_point.
//    Approaching  <=>  vn = vrel . n  < 0   (apply impulse)
//    Separating   <=>  vn > 0              (skip)
//  - Impulse P = j*n :  B += P ,  A -= P  (pushes them apart along n).
//
//  Collision
//  ---------
//  - OBB vs OBB via SAT. Contact point = average of the corners of one
//    box lying inside the other (closest vertex pair for edge-edge).
//    For a cell resting on the platform this places the contact at the
//    support edge / bottom face, so toppling emerges from the solver.
//  - Sequential-impulse solver (accumulated normal+tangential, Coulomb
//    friction) + Baumgarte position correction. Restitution = 0.
//  - A small "speculative" skin keeps resting contacts alive so resting
//    blocks do not oscillate on/off contact and can settle.
// ============================================================

(function (global) {
  'use strict';

  // ---- tunables ----
  const GRAVITY         = 2600;   // px/s^2  (+y, downward)
  const RESTITUTION     = 0.0;
  const POS_CORRECT_PCT = 0.42;
  const POS_SLOP        = 0.5;
  const CONTACT_SKIN    = 1.2;    // px: speculative-contact margin
  const SOLVER_ITERS    = 14;
  const POS_ITERS       = 4;
  const LINEAR_DAMP     = 0.9;    // 1/s (horizontal only)
  const ANG_DAMP        = 1.6;    // 1/s
  const SLEEP_VEL       = 7;     // px/s
  const SLEEP_ANGVEL    = 0.10;   // rad/s
  const SLEEP_TIME      = 0.35;   // s of stillness => settled

  // ---- vector helpers ----
  const V = {
    sub:(a,b)=>({x:a.x-b.x,y:a.y-b.y}),
    add:(a,b)=>({x:a.x+b.x,y:a.y+b.y}),
    scale:(a,k)=>({x:a.x*k,y:a.y*k}),
    dot:(a,b)=>a.x*b.x+a.y*b.y,
    cross:(a,b)=>a.x*b.y-a.y*b.x,
    len:(a)=>Math.hypot(a.x,a.y),
  };

  function obbAABB(cx,cy,hx,hy,ang){
    const c=Math.cos(ang), s=Math.sin(ang);
    const ex=Math.abs(c)*hx + Math.abs(s)*hy;
    const ey=Math.abs(s)*hx + Math.abs(c)*hy;
    return {minX:cx-ex,minY:cy-ey,maxX:cx+ex,maxY:cy+ey};
  }
  function obbCorners(cx,cy,hx,hy,ang){
    const c=Math.cos(ang), s=Math.sin(ang);
    const o=[[-hx,-hy],[hx,-hy],[hx,hy],[-hx,hy]];
    const out=new Array(4);
    for(let i=0;i<4;i++){
      const x=o[i][0], y=o[i][1];
      out[i]={x:cx + x*c - y*s, y:cy + x*s + y*c};
    }
    return out;
  }
  function pointInOBB(px,py,cx,cy,hx,hy,ang){
    const dx=px-cx, dy=py-cy;
    const c=Math.cos(ang), s=Math.sin(ang);
    const lx= dx*c + dy*s;   // rotate by -ang into local frame
    const ly=-dx*s + dy*c;
    return Math.abs(lx)<=hx+0.01 && Math.abs(ly)<=hy+0.01;
  }
  function aabbOverlap(a,b){
    return !(a.minX>b.maxX || a.maxX<b.minX || a.minY>b.maxY || a.maxY<b.minY);
  }

  // SAT between two OBBs. normal points A->B. depth may be <=0 within skin.
  function satOBB(A,B){
    const aC=obbCorners(A.cx,A.cy,A.hx,A.hy,A.ang);
    const bC=obbCorners(B.cx,B.cy,B.hx,B.hy,B.ang);
    const axes=[
      {x:Math.cos(A.ang), y:Math.sin(A.ang)},
      {x:-Math.sin(A.ang), y:Math.cos(A.ang)},
      {x:Math.cos(B.ang), y:Math.sin(B.ang)},
      {x:-Math.sin(B.ang), y:Math.cos(B.ang)},
    ];
    let minDepth=Infinity, normal=null;
    for(let i=0;i<4;i++){
      const ax=axes[i];
      let aMin=Infinity,aMax=-Infinity,bMin=Infinity,bMax=-Infinity;
      for(let k=0;k<4;k++){
        const da=aC[k].x*ax.x+aC[k].y*ax.y;
        if(da<aMin)aMin=da; if(da>aMax)aMax=da;
        const db=bC[k].x*ax.x+bC[k].y*ax.y;
        if(db<bMin)bMin=db; if(db>bMax)bMax=db;
      }
      const ov=Math.min(aMax,bMax)-Math.max(aMin,bMin);
      if(ov < -CONTACT_SKIN) return null;   // clearly separated
      if(ov<minDepth){
        minDepth=ov;
        let nx=ax.x, ny=ax.y;
        const d=(B.cx-A.cx)*nx + (B.cy-A.cy)*ny;
        if(d<0){ nx=-nx; ny=-ny; }
        normal={x:nx,y:ny};
      }
    }
    // contact point lies on the contact surface (the near face of B) at the
    // tangential centre of the A-B overlap. Keeping the contact on the
    // surface (not deep inside the penetration) yields sane impulse torque.
    const bCenterN = B.cx*normal.x + B.cy*normal.y;
    let bMinN=Infinity, bMaxN=-Infinity;
    for(let k=0;k<4;k++){
      const db=bC[k].x*normal.x + bC[k].y*normal.y;
      if(db<bMinN)bMinN=db; if(db>bMaxN)bMaxN=db;
    }
    const aCenterN = A.cx*normal.x + A.cy*normal.y;
    const faceN = (aCenterN < bCenterN) ? bMinN : bMaxN;   // B's near face toward A
    // tangent axis (perpendicular to normal)
    const tx=-normal.y, ty=normal.x;
    // overlap interval of A and B along the tangent -> midpoint = patch centre
    let aTanMin=Infinity,aTanMax=-Infinity,bTanMin=Infinity,bTanMax=-Infinity;
    for(let k=0;k<4;k++){
      const da=aC[k].x*tx+aC[k].y*ty; if(da<aTanMin)aTanMin=da; if(da>aTanMax)aTanMax=da;
      const db=bC[k].x*tx+bC[k].y*ty; if(db<bTanMin)bTanMin=db; if(db>bTanMax)bTanMax=db;
    }
    const tanLo=Math.max(aTanMin,bTanMin), tanHi=Math.min(aTanMax,bTanMax);
    const tanMid=(tanLo+tanHi)/2;
    let contact;
    if(tanHi>=tanLo-0.5){
      // B centre -> move to near face along normal -> move along tangent so that
      // the tangent-projection equals tanMid.
      const bTanProj = B.cx*tx + B.cy*ty;
      const wT = tanMid - bTanProj;
      contact={x: B.cx + (faceN-bCenterN)*normal.x + wT*tx,
               y: B.cy + (faceN-bCenterN)*normal.y + wT*ty};
    } else {
      // fallback: closest corner pair midpoint
      let best=Infinity,pa=aC[0],pb=bC[0];
      for(let i=0;i<4;i++)for(let j=0;j<4;j++){
        const d=Math.hypot(aC[i].x-bC[j].x, aC[i].y-bC[j].y);
        if(d<best){ best=d; pa=aC[i]; pb=bC[j]; }
      }
      contact={x:(pa.x+pb.x)/2, y:(pa.y+pb.y)/2};
    }
    return {normal, depth:minDepth, contact};
  }

  // ============================================================
  //  RigidBody (dynamic)
  // ============================================================
  class RigidBody {
    constructor(cells, color, name, half){
      this.color=color; this.name=name; this.half=half;
      const N=cells.length;
      this.mass=N; this.invMass=1/N;
      let cx=0,cy=0;
      for(let i=0;i<N;i++){ cx+=cells[i].x; cy+=cells[i].y; }
      cx/=N; cy/=N;
      this.pos={x:cx,y:cy};
      this.angle=0; this.vel={x:0,y:0}; this.angVel=0;
      this.localCells=new Array(N);
      for(let i=0;i<N;i++) this.localCells[i]={x:cells[i].x-cx, y:cells[i].y-cy};
      let I=0;
      for(let i=0;i<N;i++){
        const lx=this.localCells[i].x, ly=this.localCells[i].y;
        I += (lx*lx+ly*ly) + (2*half*half/3); // parallel axis + square own-inertia (m s^2/6)
      }
      this.inertia=I||1;
      this.invInertia = I>0 ? 1/I : 0;
      this.isStatic=false; this.friction=null;
      this.stillTime=0; this.placed=false; this.placeContribution=0;
      this.aabb={minX:0,minY:0,maxX:0,maxY:0};
      this.recomputeAABB();
    }
    getWorldCells(){
      const c=Math.cos(this.angle), s=Math.sin(this.angle);
      const out=new Array(this.localCells.length);
      for(let i=0;i<this.localCells.length;i++){
        const lc=this.localCells[i];
        out[i]={x:this.pos.x + lc.x*c - lc.y*s, y:this.pos.y + lc.x*s + lc.y*c};
      }
      return out;
    }
    recomputeAABB(){
      const cells=this.getWorldCells();
      let mnX=Infinity,mnY=Infinity,mxX=-Infinity,mxY=-Infinity;
      for(const c of cells){
        if(c.x<mnX)mnX=c.x; if(c.x>mxX)mxX=c.x;
        if(c.y<mnY)mnY=c.y; if(c.y>mxY)mxY=c.y;
      }
      const h=this.half;
      this.aabb={minX:mnX-h,minY:mnY-h,maxX:mxX+h,maxY:mxY+h};
    }
    topY(){
      const cells=this.getWorldCells(); let m=Infinity;
      for(const c of cells){ const t=c.y-this.half; if(t<m)m=t; }
      return m;
    }
    bottomY(){
      const cells=this.getWorldCells(); let m=-Infinity;
      for(const c of cells){ const b=c.y+this.half; if(b>m)m=b; }
      return m;
    }
  }

  // ============================================================
  //  StaticBody (immovable AABB)
  // ============================================================
  class StaticBody {
    constructor(cx,cy,hx,hy,type,friction){
      this.pos={x:cx,y:cy}; this.cx=cx; this.cy=cy; this.hx=hx; this.hy=hy; this.ang=0;
      this.vel={x:0,y:0}; this.angVel=0;
      this.invMass=0; this.invInertia=0; this.isStatic=true;
      this.type=type; this.friction=friction;
      this.aabb={minX:cx-hx,minY:cy-hy,maxX:cx+hx,maxY:cy+hy};
    }
  }

  // ============================================================
  //  PhysicsWorld
  // ============================================================
  class PhysicsWorld {
    constructor(blockSize){
      this.block=blockSize;
      this.bodies=[]; this.statics=[];
      this.gravity=GRAVITY;
    }
    addBody(b){ this.bodies.push(b); return b; }
    addStatic(s){ this.statics.push(s); return s; }
    clear(){ this.bodies.length=0; }
    remove(body){ const i=this.bodies.indexOf(body); if(i>=0) this.bodies.splice(i,1); }

    generateContacts(){
      const h=this.block/2;
      const contacts=[];
      const bodies=this.bodies, statics=this.statics;
      // dynamic vs static
      for(let bi=0;bi<bodies.length;bi++){
        const body=bodies[bi];
        const cells=body.getWorldCells();
        for(let si=0;si<statics.length;si++){
          const stat=statics[si];
          if(!aabbOverlap(body.aabb,stat.aabb)) continue;
          for(let ci=0;ci<cells.length;ci++){
            const cell=cells[ci];
            const cellAABB=obbAABB(cell.x,cell.y,h,h,body.angle);
            if(!aabbOverlap(cellAABB,stat.aabb)) continue;
            const res=satOBB({cx:cell.x,cy:cell.y,hx:h,hy:h,ang:body.angle},
                             {cx:stat.cx,cy:stat.cy,hx:stat.hx,hy:stat.hy,ang:0});
            if(res){
              contacts.push({A:body,B:stat,normal:res.normal,contact:res.contact,
                depth:res.depth,friction:stat.friction,nImp:0,tImp:0});
            }
          }
        }
      }
      // dynamic vs dynamic
      for(let bi=0;bi<bodies.length;bi++){
        const A=bodies[bi];
        for(let bj=bi+1;bj<bodies.length;bj++){
          const B=bodies[bj];
          if(!aabbOverlap(A.aabb,B.aabb)) continue;
          const cellsA=A.getWorldCells(), cellsB=B.getWorldCells();
          for(let ci=0;ci<cellsA.length;ci++){
            const ca=cellsA[ci];
            const aabbA=obbAABB(ca.x,ca.y,h,h,A.angle);
            for(let cj=0;cj<cellsB.length;cj++){
              const cb=cellsB[cj];
              const aabbB=obbAABB(cb.x,cb.y,h,h,B.angle);
              if(!aabbOverlap(aabbA,aabbB)) continue;
              const res=satOBB({cx:ca.x,cy:ca.y,hx:h,hy:h,ang:A.angle},
                               {cx:cb.x,cy:cb.y,hx:h,hy:h,ang:B.angle});
              if(res){
                contacts.push({A,B,normal:res.normal,contact:res.contact,
                  depth:res.depth,friction:0.45,nImp:0,tImp:0});
              }
            }
          }
        }
      }
      return contacts;
    }

    resolveVelocity(c){
      const A=c.A, B=c.B;
      const rA={x:c.contact.x-A.pos.x, y:c.contact.y-A.pos.y};
      const rB={x:c.contact.x-B.pos.x, y:c.contact.y-B.pos.y};
      // point velocities
      const vAx=A.vel.x - A.angVel*rA.y, vAy=A.vel.y + A.angVel*rA.x;
      const vBx=B.vel.x - B.angVel*rB.y, vBy=B.vel.y + B.angVel*rB.x;
      // vrel = vB_point - vA_point   (n points A->B)
      const rvx=vBx-vAx, rvy=vBy-vAy;
      const vn=rvx*c.normal.x + rvy*c.normal.y;
      const rAn=V.cross(rA,c.normal);
      const rBn=V.cross(rB,c.normal);
      const denom=A.invMass+B.invMass + rAn*rAn*A.invInertia + rBn*rBn*B.invInertia;
      if(denom<=0) return;
      // Allow the normal impulse to grow OR shrink, clamped to >= 0
      // (so an over-applied impulse from a sibling contact can be
      // redistributed back). This keeps symmetric stacks stable.
      let j=-(1+RESTITUTION)*vn/denom;
      let newN=c.nImp+j;
      if(newN<0) newN=0;
      const dN=newN-c.nImp; c.nImp=newN;
      const Jx=c.normal.x*dN, Jy=c.normal.y*dN;
      // P = dN*n ;  B += P ,  A -= P
      B.vel.x+=Jx*B.invMass; B.vel.y+=Jy*B.invMass;
      B.angVel+=V.cross(rB,{x:Jx,y:Jy})*B.invInertia;
      A.vel.x-=Jx*A.invMass; A.vel.y-=Jy*A.invMass;
      A.angVel-=V.cross(rA,{x:Jx,y:Jy})*A.invInertia;

      // friction (tangential)
      const tx=-c.normal.y, ty=c.normal.x;
      const vAx2=A.vel.x - A.angVel*rA.y, vAy2=A.vel.y + A.angVel*rA.x;
      const vBx2=B.vel.x - B.angVel*rB.y, vBy2=B.vel.y + B.angVel*rB.x;
      const vt=(vBx2-vAx2)*tx + (vBy2-vAy2)*ty;
      const rAt=V.cross(rA,{x:tx,y:ty});
      const rBt=V.cross(rB,{x:tx,y:ty});
      const denomT=A.invMass+B.invMass + rAt*rAt*A.invInertia + rBt*rBt*B.invInertia;
      if(denomT<=0) return;
      let jt=-vt/denomT;
      const maxF=c.friction*c.nImp;
      let newT=c.tImp+jt;
      if(newT>maxF)newT=maxF; else if(newT<-maxF)newT=-maxF;
      const dT=newT-c.tImp; c.tImp=newT;
      const Tx=tx*dT, Ty=ty*dT;
      B.vel.x+=Tx*B.invMass; B.vel.y+=Ty*B.invMass;
      B.angVel+=V.cross(rB,{x:Tx,y:Ty})*B.invInertia;
      A.vel.x-=Tx*A.invMass; A.vel.y-=Ty*A.invMass;
      A.angVel-=V.cross(rA,{x:Tx,y:Ty})*A.invInertia;
    }

    correctPosition(c){
      const corr=Math.max(c.depth-POS_SLOP,0)*POS_CORRECT_PCT;
      if(corr<=0) return;
      const total=c.A.invMass+c.B.invMass;
      if(total===0) return;
      const cm=corr/total;
      const dx=c.normal.x*cm, dy=c.normal.y*cm;
      // n points A->B : push A by -n, B by +n
      c.A.pos.x-=dx*c.A.invMass; c.A.pos.y-=dy*c.A.invMass;
      c.B.pos.x+=dx*c.B.invMass; c.B.pos.y+=dy*c.B.invMass;
    }

    step(dt){
      // 1. integrate forces
      for(const b of this.bodies){
        b.vel.y += this.gravity*dt;
        const lf=Math.exp(-LINEAR_DAMP*dt);
        const af=Math.exp(-ANG_DAMP*dt);
        b.vel.x*=lf; b.angVel*=af;
      }
      // 2. contacts
      const contacts=this.generateContacts();
      // 3. solve velocities
      for(let it=0;it<SOLVER_ITERS;it++)
        for(let i=0;i<contacts.length;i++) this.resolveVelocity(contacts[i]);
      // 4. integrate positions
      for(const b of this.bodies){
        b.pos.x+=b.vel.x*dt; b.pos.y+=b.vel.y*dt; b.angle+=b.angVel*dt;
      }
      // 5. position correction
      for(let it=0;it<POS_ITERS;it++)
        for(let i=0;i<contacts.length;i++) this.correctPosition(contacts[i]);
      // 6. AABBs + still-time
      for(const b of this.bodies){
        b.recomputeAABB();
        const sp=Math.hypot(b.vel.x,b.vel.y);
        if(sp<SLEEP_VEL && Math.abs(b.angVel)<SLEEP_ANGVEL) b.stillTime+=dt;
        else b.stillTime=0;
      }
      return contacts;
    }

    isSettled(){
      if(this.bodies.length===0) return true;
      for(const b of this.bodies) if(b.stillTime < SLEEP_TIME) return false;
      return true;
    }
  }

  global.PhysicsTetris = {
    RigidBody, StaticBody, PhysicsWorld,
    satOBB, obbAABB, obbCorners, pointInOBB, aabbOverlap, V,
    consts:{GRAVITY,RESTITUTION,CONTACT_SKIN,SOLVER_ITERS,SLEEP_VEL,SLEEP_ANGVEL,SLEEP_TIME},
  };
})(typeof window!=='undefined'?window:globalThis);
